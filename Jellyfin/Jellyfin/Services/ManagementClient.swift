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
}

struct HeartbeatRequest: Encodable {
    var ipAddress: String?
    var nowPlaying: NowPlaying?
    var lastError: String?

    struct NowPlaying: Encodable {
        let title: String
        let itemId: String
        let positionTicks: Int64
    }

    enum CodingKeys: String, CodingKey { case ipAddress, nowPlaying, lastError }

    /// `nowPlaying` and `lastError` are *always* encoded (as `null` when absent),
    /// so each heartbeat reports the unit's current status. That lets the server
    /// clear a previous now-playing item or error once it's no longer true,
    /// instead of leaving stale values that never go away.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(ipAddress, forKey: .ipAddress)
        try c.encode(nowPlaying, forKey: .nowPlaying)
        try c.encode(lastError, forKey: .lastError)
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

    private func request(_ path: String, method: String = "GET", body: Data? = nil, authed: Bool = true) -> URLRequest? {
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
    func heartbeat(ipAddress: String? = nil, nowPlaying: HeartbeatRequest.NowPlaying? = nil, lastError: String? = nil) async throws -> HeartbeatResponse {
        let payload = HeartbeatRequest(ipAddress: ipAddress, nowPlaying: nowPlaying, lastError: lastError)
        let body = try encoder.encode(payload)
        guard let request = request("devices/\(identity.unitId)/heartbeat", method: "POST", body: body) else {
            throw ManagementError.badURL
        }
        return try await send(request, as: HeartbeatResponse.self)
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
}
