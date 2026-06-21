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
        request.setValue(authorizationHeader(), forHTTPHeaderField: "X-Emby-Authorization")
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
        if let token = accessToken { query.append(URLQueryItem(name: "api_key", value: token)) }
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
    /// remuxes/direct-streams codecs AVPlayer can decode (H.264 / HEVC + AAC / AC3 /
    /// MP3) and transcodes anything it can't (e.g. MPEG-2, VC-1) to H.264 — so
    /// playback works regardless of the source format. (Direct static streaming was
    /// removed because Apple devices have no MPEG-2 decoder, so it silently failed
    /// on such content.) A bitrate cap, or `preferDirectPlay == false`, bounds the
    /// streaming bitrate.
    func playbackURL(for item: BaseItem, playback: UnitConfig.Playback) -> URL? {
        guard let token = accessToken else { return nil }
        var components = URLComponents(
            url: serverURL.appendingPathComponent("Videos/\(item.id)/master.m3u8"),
            resolvingAgainstBaseURL: false
        )
        var query = [
            URLQueryItem(name: "api_key", value: token),
            URLQueryItem(name: "deviceId", value: deviceId),
            URLQueryItem(name: "mediaSourceId", value: item.id),
            URLQueryItem(name: "videoCodec", value: "h264,hevc"),
            URLQueryItem(name: "audioCodec", value: "aac,ac3,eac3,mp3"),
            URLQueryItem(name: "transcodingContainer", value: "ts"),
            URLQueryItem(name: "transcodingProtocol", value: "hls")
        ]
        if playback.maxBitrateMbps > 0 {
            query.append(URLQueryItem(name: "maxStreamingBitrate", value: String(Int(playback.maxBitrateMbps * 1_000_000))))
        } else if !playback.preferDirectPlay {
            query.append(URLQueryItem(name: "maxStreamingBitrate", value: "8000000"))
        }
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
        if let token = accessToken { query.append(URLQueryItem(name: "api_key", value: token)) }
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
