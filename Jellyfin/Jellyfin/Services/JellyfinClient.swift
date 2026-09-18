//
//  JellyfinClient.swift
//  Jellyfin
//
//  A small, dependency-free client for the Jellyfin REST API: authenticate with
//  the shared service account, list libraries and folder children, build image
//  and playback URLs.
//

import Foundation

enum JellyfinError: LocalizedError {
    case badServerURL
    case notAuthenticated
    case http(Int)
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .badServerURL: return "The Jellyfin server address is invalid."
        case .notAuthenticated: return "Not signed in to Jellyfin yet."
        case .http(let code):
            if code == 401 { return "Jellyfin rejected the username or password." }
            return "Jellyfin returned an error (HTTP \(code))."
        case .decoding(let detail): return "Couldn't read the response from Jellyfin. \(detail)"
        case .transport(let detail): return "Couldn't reach the Jellyfin server. \(detail)"
        }
    }
}

final class JellyfinClient {
    private let serverURL: URL
    private let credentials: UnitConfig.Jellyfin
    private let deviceId: String
    private let deviceName: String
    private let appVersion: String
    private let session: URLSession

    private(set) var accessToken: String?
    private(set) var userId: String?

    init?(config: UnitConfig.Jellyfin, deviceId: String, deviceName: String, appVersion: String) {
        var trimmed = config.serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        // Strip any trailing slash for consistent path joining.
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard let components = URLComponents(string: trimmed), components.scheme != nil,
              let normalized = components.url else { return nil }

        self.serverURL = normalized
        self.credentials = config
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.appVersion = appVersion

        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        // Fail fast on an unreachable server instead of waiting indefinitely, so
        // the app can surface "Couldn't reach the Jellyfin server" and retry.
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
    }

    var isAuthenticated: Bool { accessToken != nil && userId != nil }

    // MARK: - Authorization header

    private func authorizationHeader() -> String {
        var value = "MediaBrowser Client=\"Jellyfin Apple TV\", Device=\"\(deviceName)\", DeviceId=\"\(deviceId)\", Version=\"\(appVersion)\""
        if let token = accessToken {
            value += ", Token=\"\(token)\""
        }
        return value
    }

    private func makeRequest(path: String, queryItems: [URLQueryItem] = [], method: String = "GET", body: Data? = nil) -> URLRequest? {
        guard var components = URLComponents(url: serverURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            return nil
        }
        if !queryItems.isEmpty { components.queryItems = queryItems }
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        // Jellyfin 12+ reads the standard `Authorization` header by default and only
        // falls back to the legacy `X-Emby-Authorization` when the server has
        // "EnableLegacyAuthorization" turned on — a client sending only the legacy
        // header gets back a 400 ("request.App" missing) before credentials are even
        // checked. Sending both covers old and new servers without needing a
        // server-side setting. Confirmed against a live Jellyfin 12.1.0 server:
        // X-Emby-Authorization alone -> 400; adding Authorization -> reaches normal
        // 401 (bad credentials) / 200 (good ones) instead.
        let auth = authorizationHeader()
        request.setValue(auth, forHTTPHeaderField: "Authorization")
        request.setValue(auth, forHTTPHeaderField: "X-Emby-Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw JellyfinError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw JellyfinError.http(http.statusCode)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw JellyfinError.decoding(error.localizedDescription)
        }
    }

    // MARK: - Endpoints

    @discardableResult
    func authenticate() async throws -> JellyfinUser {
        let payload = JellyfinAuthRequest(Username: credentials.username, Pw: credentials.password)
        let body = try JSONEncoder().encode(payload)
        guard let request = makeRequest(path: "Users/AuthenticateByName", method: "POST", body: body) else {
            throw JellyfinError.badServerURL
        }
        let auth = try await send(request, as: JellyfinAuthResponse.self)
        self.accessToken = auth.accessToken
        self.userId = auth.user.id
        return auth.user
    }

    /// Top-level libraries the service account can see.
    func userViews() async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        guard let request = makeRequest(path: "UserViews", queryItems: [
            URLQueryItem(name: "userId", value: userId)
        ]) else { throw JellyfinError.badServerURL }
        return try await send(request, as: ItemsResponse.self).items
    }

    /// Children of a folder/library/series/season.
    func items(parentId: String) async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let query = [
            URLQueryItem(name: "userId", value: userId),
            URLQueryItem(name: "parentId", value: parentId),
            URLQueryItem(name: "SortBy", value: "IsFolder,SortName"),
            URLQueryItem(name: "SortOrder", value: "Ascending"),
            URLQueryItem(name: "Fields", value: Self.itemFields),
            URLQueryItem(name: "ImageTypeLimit", value: "1"),
            URLQueryItem(name: "EnableImageTypes", value: Self.imageTypes),
            URLQueryItem(name: "Recursive", value: "false")
        ]
        guard let request = makeRequest(path: "Items", queryItems: query) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: ItemsResponse.self).items
    }

    func systemInfo() async throws -> JellyfinSystemInfo {
        guard let request = makeRequest(path: "System/Info/Public") else { throw JellyfinError.badServerURL }
        return try await send(request, as: JellyfinSystemInfo.self)
    }

    // MARK: - URLs

    /// Poster / thumbnail URL for an item, sized for the grid.
    func imageURL(for item: BaseItem, maxHeight: Int = 600) -> URL? {
        let tag: String?
        let imageType: String
        if let primary = item.primaryImageTag {
            tag = primary; imageType = "Primary"
        } else if let thumb = item.thumbImageTag {
            tag = thumb; imageType = "Thumb"
        } else {
            tag = nil; imageType = "Primary"
        }
        var components = URLComponents(url: serverURL.appendingPathComponent("Items/\(item.id)/Images/\(imageType)"), resolvingAgainstBaseURL: false)
        var query = [
            URLQueryItem(name: "fillHeight", value: String(maxHeight)),
            URLQueryItem(name: "quality", value: "90")
        ]
        if let tag { query.append(URLQueryItem(name: "tag", value: tag)) }
        if let token = accessToken { query.append(URLQueryItem(name: "ApiKey", value: token)) }
        components?.queryItems = query
        return components?.url
    }

    /// Backdrop image for detail/hero backgrounds, falling back to the parent
    /// (series) backdrop for episodes that have none of their own.
    func backdropURL(for item: BaseItem, maxWidth: Int = 1920) -> URL? {
        if let tag = item.backdropImageTags?.first {
            return image(itemId: item.id, type: "Backdrop", tag: tag, fillWidth: maxWidth)
        }
        if let parentId = item.parentBackdropItemId, let tag = item.parentBackdropImageTags?.first {
            return image(itemId: parentId, type: "Backdrop", tag: tag, fillWidth: maxWidth)
        }
        return nil
    }

    /// Playback URL for AVPlayer. Always uses Jellyfin's adaptive HLS: Jellyfin
    /// remuxes/direct-streams codecs AVPlayer can decode and transcodes anything it
    /// can't (e.g. MPEG-2, VC-1, HEVC) to H.264 — so playback works regardless of the
    /// source format. (Direct static streaming was removed because Apple devices have
    /// no MPEG-2 decoder, so it silently failed on such content.)
    ///
    /// **Always sends an explicit `maxStreamingBitrate`, even at the "Unlimited" admin
    /// setting.** Omitting the param entirely (the old behavior when `maxBitrateMbps`
    /// was 0 and `preferDirectPlay` was true — i.e. every unit's factory default) lets
    /// Jellyfin fall back to its own internal default bitrate, which is tuned for
    /// unknown/constrained networks and is visibly over-compressed — exactly the
    /// "trash quality" a fleet on one LAN with effectively unlimited bandwidth has no
    /// reason to accept. "Unlimited" here means a generous fixed ceiling
    /// (`unlimitedBitrateBps`) well above anything a real source needs, not an actually
    /// unbounded request — Jellyfin always gets a real number to target instead of
    /// picking a conservative one on its own. `preferDirectPlay` no longer affects
    /// this: forcing `h264`-only below already forces a transcode for any non-H.264
    /// source regardless of that setting, so the same generous ceiling should apply
    /// whenever a transcode happens, not a separate, lower fallback.
    ///
    /// **The query parameter is `ApiKey`, not `api_key`.** `api_key` is the legacy
    /// Emby-compatibility spelling; Jellyfin 12+ silently returns 401 for it on every
    /// endpoint under `/Videos/`, including this one — same "legacy Emby shim removed"
    /// pattern as the `X-Emby-Authorization` header (see the auth-header note in
    /// `makeRequest`). `AVPlayer(url:)` has no way to attach a custom header, so the
    /// query parameter is the *only* auth this request has — get the name wrong and
    /// the manifest request 401s outright, AVPlayer's item fails to load, and AVKit's
    /// `VideoPlayer` shows its "can't play this content" icon (a circle with a
    /// diagonal slash) over a black, frozen transport — which looks exactly like an
    /// HDCP/output-protection block but isn't. Confirmed against a live Jellyfin
    /// 12.1.0 server end to end: `api_key` → 401 on `master.m3u8`; `ApiKey` → 200,
    /// and the resulting manifest/segment URLs (which Jellyfin itself generates,
    /// carrying the same `ApiKey` param forward) resolve to real `video/mp2t` bytes.
    ///
    /// `videoCodec` lists **only** `h264`, even though tvOS can decode HEVC: this
    /// client builds the HLS URL by hand instead of going through Jellyfin's
    /// `/PlaybackInfo` negotiation (where a proper `DeviceProfile` could declare "no
    /// 10-bit/HDR HEVC"), so the codec allow-list is the direct-play/direct-stream
    /// rejection rule this simplified `master.m3u8` endpoint most reliably enforces —
    /// `videoRangeType=SDR` + `maxVideoBitDepth=8` are kept as best-effort hints for
    /// when a transcode does happen, but excluding `hevc` guarantees one happens for
    /// any non-H.264 source, and ffmpeg's H.264 encoder only ever produces 8-bit SDR.
    /// Worth keeping even though it wasn't the cause of the `ApiKey` bug above (this
    /// fleet's library is already plain 8-bit H.264) — it forecloses a real HDR/HEVC
    /// failure mode for any future content, at the cost of transcode CPU on sources
    /// that were already safe HEVC, the right trade for a managed fleet.
    /// 100 Mbps — comfortably above any real-world source's bitrate on a LAN, used
    /// whenever the admin's "Max bitrate" is left at "Unlimited" (0) so Jellyfin
    /// always receives an explicit, generous ceiling instead of picking its own
    /// conservative default.
    private static let unlimitedBitrateBps = 100_000_000

    func playbackURL(for item: BaseItem, playback: UnitConfig.Playback) -> URL? {
        guard let token = accessToken else { return nil }
        var components = URLComponents(
            url: serverURL.appendingPathComponent("Videos/\(item.id)/master.m3u8"),
            resolvingAgainstBaseURL: false
        )
        let bitrateBps = playback.maxBitrateMbps > 0
            ? Int(playback.maxBitrateMbps * 1_000_000)
            : Self.unlimitedBitrateBps
        let query = [
            URLQueryItem(name: "ApiKey", value: token),
            URLQueryItem(name: "deviceId", value: deviceId),
            URLQueryItem(name: "mediaSourceId", value: item.id),
            URLQueryItem(name: "videoCodec", value: "h264"),
            URLQueryItem(name: "audioCodec", value: "aac,ac3,eac3,mp3"),
            URLQueryItem(name: "transcodingContainer", value: "ts"),
            URLQueryItem(name: "transcodingProtocol", value: "hls"),
            URLQueryItem(name: "videoRangeType", value: "SDR"),
            URLQueryItem(name: "maxVideoBitDepth", value: "8"),
            URLQueryItem(name: "maxStreamingBitrate", value: String(bitrateBps))
        ]
        components?.queryItems = query
        return components?.url
    }
}

// MARK: - Home feed, search, images, playback reporting

extension JellyfinClient {

    static let itemFields = "Overview,PrimaryImageAspectRatio,ChildCount,Genres,ProductionYear,CommunityRating,OfficialRating,SeriesName,ParentBackdropImageTags,ParentBackdropItemId,ParentThumbItemId,ParentThumbImageTag,RunTimeTicks,Status"
    static let imageTypes = "Primary,Backdrop,Thumb"

    /// Continue Watching — partially played items.
    func resumeItems(limit: Int = 16) async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let query = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "mediaTypes", value: "Video"),
            URLQueryItem(name: "fields", value: Self.itemFields),
            URLQueryItem(name: "enableImageTypes", value: Self.imageTypes),
            URLQueryItem(name: "imageTypeLimit", value: "1")
        ]
        guard let request = makeRequest(path: "Users/\(userId)/Items/Resume", queryItems: query) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: ItemsResponse.self).items
    }

    /// Recently added items for a library. (This endpoint returns a raw array.)
    func latestItems(parentId: String, limit: Int = 20) async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let query = [
            URLQueryItem(name: "parentId", value: parentId),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "fields", value: Self.itemFields),
            URLQueryItem(name: "enableImageTypes", value: Self.imageTypes),
            URLQueryItem(name: "imageTypeLimit", value: "1")
        ]
        guard let request = makeRequest(path: "Users/\(userId)/Items/Latest", queryItems: query) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: [BaseItem].self)
    }

    /// Next Up — the next episode to watch for in-progress series.
    func nextUp(limit: Int = 16) async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let query = [
            URLQueryItem(name: "userId", value: userId),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "fields", value: Self.itemFields),
            URLQueryItem(name: "enableImageTypes", value: Self.imageTypes),
            URLQueryItem(name: "imageTypeLimit", value: "1")
        ]
        guard let request = makeRequest(path: "Shows/NextUp", queryItems: query) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: ItemsResponse.self).items
    }

    /// Full-text search across the user's libraries.
    func search(query: String, limit: Int = 40) async throws -> [BaseItem] {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let items = [
            URLQueryItem(name: "userId", value: userId),
            URLQueryItem(name: "searchTerm", value: trimmed),
            URLQueryItem(name: "recursive", value: "true"),
            URLQueryItem(name: "includeItemTypes", value: "Movie,Series,Episode,BoxSet,MusicVideo,Video"),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "fields", value: Self.itemFields),
            URLQueryItem(name: "enableImageTypes", value: Self.imageTypes),
            URLQueryItem(name: "imageTypeLimit", value: "1")
        ]
        guard let request = makeRequest(path: "Items", queryItems: items) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: ItemsResponse.self).items
    }

    /// A single item with full metadata (for the detail screen).
    func item(id: String) async throws -> BaseItem {
        guard let userId else { throw JellyfinError.notAuthenticated }
        let query = [URLQueryItem(name: "fields", value: Self.itemFields)]
        guard let request = makeRequest(path: "Users/\(userId)/Items/\(id)", queryItems: query) else {
            throw JellyfinError.badServerURL
        }
        return try await send(request, as: BaseItem.self)
    }

    // MARK: Images

    /// A 16:9-friendly image for landscape cards: Thumb → Backdrop → parent → Primary.
    func wideImageURL(for item: BaseItem, maxWidth: Int = 700) -> URL? {
        if let tag = item.thumbImageTag {
            return image(itemId: item.id, type: "Thumb", tag: tag, fillWidth: maxWidth)
        }
        if let tag = item.backdropImageTags?.first {
            return image(itemId: item.id, type: "Backdrop", tag: tag, fillWidth: maxWidth)
        }
        if let parentId = item.parentThumbItemId, let tag = item.parentThumbImageTag {
            return image(itemId: parentId, type: "Thumb", tag: tag, fillWidth: maxWidth)
        }
        if let parentId = item.parentBackdropItemId, let tag = item.parentBackdropImageTags?.first {
            return image(itemId: parentId, type: "Backdrop", tag: tag, fillWidth: maxWidth)
        }
        if let tag = item.primaryImageTag {
            return image(itemId: item.id, type: "Primary", tag: tag, fillWidth: maxWidth)
        }
        return nil
    }

    func image(itemId: String, type: String, tag: String, fillWidth: Int? = nil, fillHeight: Int? = nil) -> URL? {
        var components = URLComponents(
            url: serverURL.appendingPathComponent("Items/\(itemId)/Images/\(type)"),
            resolvingAgainstBaseURL: false
        )
        var query = [
            URLQueryItem(name: "tag", value: tag),
            URLQueryItem(name: "quality", value: "90")
        ]
        if let fillWidth { query.append(URLQueryItem(name: "fillWidth", value: String(fillWidth))) }
        if let fillHeight { query.append(URLQueryItem(name: "fillHeight", value: String(fillHeight))) }
        if let token = accessToken { query.append(URLQueryItem(name: "ApiKey", value: token)) }
        components?.queryItems = query
        return components?.url
    }

    // MARK: Playback reporting (so Jellyfin tracks watched state + resume)

    func reportPlaybackStart(itemId: String, positionTicks: Int64 = 0) async {
        await postPlayback(path: "Sessions/Playing", itemId: itemId, positionTicks: positionTicks)
    }

    func reportPlaybackProgress(itemId: String, positionTicks: Int64) async {
        await postPlayback(path: "Sessions/Playing/Progress", itemId: itemId, positionTicks: positionTicks)
    }

    func reportPlaybackStopped(itemId: String, positionTicks: Int64) async {
        await postPlayback(path: "Sessions/Playing/Stopped", itemId: itemId, positionTicks: positionTicks)
    }

    private func postPlayback(path: String, itemId: String, positionTicks: Int64) async {
        struct Body: Encodable {
            let ItemId: String
            let PositionTicks: Int64
        }
        guard let body = try? JSONEncoder().encode(Body(ItemId: itemId, PositionTicks: positionTicks)),
              let request = makeRequest(path: path, method: "POST", body: body) else { return }
        _ = try? await session.data(for: request)
    }
}
