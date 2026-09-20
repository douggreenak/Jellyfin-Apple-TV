//
//  ManagementClient.swift
//  Jellyfin
//
//  Talks to the central management server: registers this unit, fetches its
//  UnitConfig, and sends periodic heartbeats (which also deliver commands and
//  signal when the config has changed).
//

import Foundation

enum ManagementError: LocalizedError {
    case badURL
    case notRegistered
    case http(Int)
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "The management server address is invalid."
        case .notRegistered: return "This unit hasn't registered with the management server yet."
        case .http(let code): return "The management server returned an error (HTTP \(code))."
        case .decoding(let detail): return "Couldn't read the management server response. \(detail)"
        case .transport(let detail): return "Couldn't reach the management server. \(detail)"
        }
    }
}

// MARK: - Wire types

private struct RegisterRequest: Encodable {
    let unitId: String
    let deviceName: String
    let model: String
    let tvosVersion: String
    let appVersion: String
}

private struct RegisterResponse: Decodable {
    let unit: ServerUnit
    let token: String
}

private struct ServerUnit: Decodable {
    let config: UnitConfig
}

struct DeviceCommand: Decodable, Equatable {
    let id: String
    let type: String
    /// For "migrate": the new management server base URL.
    let data: String?
}

struct HeartbeatResponse: Decodable {
    let ok: Bool
    let configVersion: Int
    let command: DeviceCommand?
    /// Persistent "please highlight yourself" state — replaces the old one-shot
    /// "identify" command. True for as long as an admin has it turned on, or
    /// until this device itself dismisses it (see `identifyDismissed` below).
    let identifying: Bool
    /// The management server's own version, for display on the identify overlay.
    /// Absent only against a server old enough not to send it yet.
    let serverVersion: String?
}

struct HeartbeatRequest: Encodable {
    var ipAddress: String?
    var nowPlaying: NowPlaying?
    var lastError: String?
    /// Sent on every heartbeat (not just at register) so the server's view of what a
    /// unit is running never goes stale — a unit keeps its device token across an
    /// app update (pushed via MDM), so it never re-registers, and register is the
    /// only other place this is reported.
    var appVersion: String?
    /// Same freshness reasoning as appVersion — a tvOS software update can land
    /// between registers too.
    var tvosVersion: String?
    /// This device's real name recovered via Bonjour (DeviceIdentity.localName),
    /// once/if LocalDeviceNameResolver has resolved it. Absent (not just nil) on
    /// heartbeats sent before resolution succeeds, or if it never does — the
    /// server only auto-adopts a unit's display name from this while that name is
    /// still the generic placeholder, so an absent value here just means "no
    /// change," never "clear the name."
    var localName: String?
    /// Set to true on exactly one heartbeat: the one sent immediately after the
    /// user dismisses the identify overlay with the physical remote. Absent
    /// (never `false`) on every other heartbeat — there's nothing to encode when
    /// nothing happened.
    var identifyDismissed: Bool?

    struct NowPlaying: Encodable {
        let title: String
        let itemId: String
        let positionTicks: Int64
    }

    enum CodingKeys: String, CodingKey {
        case ipAddress, nowPlaying, lastError, appVersion, tvosVersion, localName, identifyDismissed
    }

    /// `nowPlaying` and `lastError` are *always* encoded (as `null` when absent),
    /// so each heartbeat reports the unit's current status. That lets the server
    /// clear a previous now-playing item or error once it's no longer true,
    /// instead of leaving stale values that never go away.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(ipAddress, forKey: .ipAddress)
        try c.encode(nowPlaying, forKey: .nowPlaying)
        try c.encode(lastError, forKey: .lastError)
        try c.encodeIfPresent(appVersion, forKey: .appVersion)
        try c.encodeIfPresent(tvosVersion, forKey: .tvosVersion)
        try c.encodeIfPresent(localName, forKey: .localName)
        try c.encodeIfPresent(identifyDismissed, forKey: .identifyDismissed)
    }
}

final class ManagementClient {
    private let identity: DeviceIdentity
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(identity: DeviceIdentity) {
        self.identity = identity
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
    }

    private var apiBase: URL? {
        var base = identity.managementBaseURL.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + "/api/v1")
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json", authed: Bool = true) -> URLRequest? {
        guard let base = apiBase else { return nil }
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authed {
            request.setValue(identity.unitId, forHTTPHeaderField: "X-Unit-Id")
            if let token = identity.deviceToken {
                request.setValue(token, forHTTPHeaderField: "X-Unit-Token")
            }
        }
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ManagementError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw ManagementError.http(http.statusCode)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw ManagementError.decoding(error.localizedDescription)
        }
    }

    // MARK: - Endpoints

    /// Registers (idempotently) and returns the server-assigned config. Stores
    /// the device token for subsequent authed calls.
    func register() async throws -> UnitConfig {
        let payload = RegisterRequest(
            unitId: identity.unitId,
            deviceName: identity.deviceName,
            model: identity.hardwareModel,
            tvosVersion: identity.tvosVersion,
            appVersion: identity.appVersion
        )
        let body = try encoder.encode(payload)
        guard let request = request("devices/register", method: "POST", body: body, authed: false) else {
            throw ManagementError.badURL
        }
        let result = try await send(request, as: RegisterResponse.self)
        identity.deviceToken = result.token
        return result.unit.config
    }

    func fetchConfig() async throws -> UnitConfig {
        guard let request = request("devices/\(identity.unitId)/config") else { throw ManagementError.badURL }
        return try await send(request, as: UnitConfig.self)
    }

    @discardableResult
    func heartbeat(
        ipAddress: String? = nil,
        nowPlaying: HeartbeatRequest.NowPlaying? = nil,
        lastError: String? = nil,
        identifyDismissed: Bool? = nil
    ) async throws -> HeartbeatResponse {
        // appVersion/tvosVersion ride on every heartbeat (not just register) so the
        // server notices an app or OS update even though the unit keeps its device
        // token. localName rides along too, once/if Bonjour resolution has found it
        // (see HeartbeatRequest.localName).
        let payload = HeartbeatRequest(
            ipAddress: ipAddress,
            nowPlaying: nowPlaying,
            lastError: lastError,
            appVersion: identity.appVersion,
            tvosVersion: identity.tvosVersion,
            localName: identity.localName,
            identifyDismissed: identifyDismissed
        )
        let body = try encoder.encode(payload)
        guard let request = request("devices/\(identity.unitId)/heartbeat", method: "POST", body: body) else {
            throw ManagementError.badURL
        }
        return try await send(request, as: HeartbeatResponse.self)
    }

    /// Downloads a fixed-size payload from the server and times it, to measure real
    /// throughput for the identify overlay. tvOS gives third-party apps no way to
    /// read actual Wi-Fi link speed or signal strength (that needs Apple's
    /// `com.apple.developer.networking.wifi-info` entitlement, requested from Apple
    /// and still wouldn't expose a real Mbps figure) — an actual measured transfer
    /// is the only number this app can produce without that entitlement, and
    /// arguably more useful anyway: real usable bandwidth to the server this unit
    /// actually talks to, not raw PHY rate. Returns nil on any failure (offline,
    /// timeout) rather than throwing — this is a "nice to have" display value, not
    /// something that should ever block or error out the identify screen.
    func measureThroughputMbps() async -> Double? {
        guard let request = request("devices/\(identity.unitId)/speedtest") else { return nil }
        let start = Date()
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              !data.isEmpty else { return nil }
        let elapsed = Date().timeIntervalSince(start)
        guard elapsed > 0 else { return nil }
        return Double(data.count) * 8 / elapsed / 1_000_000
    }

    func ack(commandId: String) async throws {
        struct AckBody: Encodable { let commandId: String }
        struct AckResponse: Decodable { let ok: Bool }
        let body = try encoder.encode(AckBody(commandId: commandId))
        guard let request = request("devices/\(identity.unitId)/ack", method: "POST", body: body) else {
            throw ManagementError.badURL
        }
        _ = try await send(request, as: AckResponse.self)
    }

    /// Cheap, frequent poll: does a dashboard operator currently have this unit's
    /// screen mirror open? Only while true should the caller incur the cost of
    /// capturing and uploading screenshots.
    func fetchLiveStatus() async throws -> Bool {
        struct LiveStatusResponse: Decodable { let screenShare: Bool }
        guard let request = request("devices/\(identity.unitId)/live") else {
            throw ManagementError.badURL
        }
        return try await send(request, as: LiveStatusResponse.self).screenShare
    }

    /// Uploads one captured screen frame (raw JPEG, not JSON) to be shown in the
    /// dashboard's live screen mirror. Only the most recent upload is kept server-side.
    func uploadScreenshot(_ data: Data) async throws {
        struct UploadResponse: Decodable { let ok: Bool }
        guard let request = request("devices/\(identity.unitId)/screenshot", method: "POST", body: data, contentType: "image/jpeg") else {
            throw ManagementError.badURL
        }
        _ = try await send(request, as: UploadResponse.self)
    }

    /// Reports one playback session's quality summary for the admin Data tab's
    /// bitrate/playback-experience charts. Best-effort and silent on failure —
    /// a lost report is just one missing data point, never something worth
    /// retrying or surfacing to the user.
    func reportPlaybackQuality(itemId: String, itemName: String, durationSeconds: Double, summary: PlaybackQualitySummary) async {
        struct Body: Encodable {
            let itemId: String
            let itemName: String
            let durationSeconds: Double
            let avgBitrateKbps: Double?
            let indicatedBitrateKbps: Double?
            let droppedFrames: Int?
            let stalls: Int?
            let width: Int?
            let height: Int?
        }
        let body = Body(
            itemId: itemId, itemName: itemName, durationSeconds: durationSeconds,
            avgBitrateKbps: summary.avgBitrateKbps, indicatedBitrateKbps: summary.indicatedBitrateKbps,
            droppedFrames: summary.droppedFrames, stalls: summary.stalls,
            width: summary.width, height: summary.height
        )
        guard let encoded = try? encoder.encode(body),
              let request = request("devices/\(identity.unitId)/playback-report", method: "POST", body: encoded) else { return }
        _ = try? await session.data(for: request)
    }
}
