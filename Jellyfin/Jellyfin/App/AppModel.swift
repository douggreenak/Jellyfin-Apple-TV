//
//  AppModel.swift
//  Jellyfin
//
//  The root state machine for a *pure managed appliance*: the Apple TV does
//  nothing without the management server. Every launch must reach the server to
//  obtain its configuration; there is no local cache, no offline mode, and no
//  on-device configuration editing. If the server is unreachable the app blocks
//  and keeps retrying until it returns.
//

import SwiftUI
import Observation

@MainActor
@Observable
final class AppModel {

    enum Phase: Equatable {
        case launching
        case registering
        case connectingJellyfin
        case waitingForContent      // server reachable, but no Jellyfin library assigned yet
        case ready
        case needsManagementServer  // cannot reach the management server — app is blocked
        case error(String)
    }

    private(set) var phase: Phase = .launching
    private(set) var config: UnitConfig
    private(set) var jellyfin: JellyfinClient?
    private(set) var libraries: [BaseItem] = []

    /// Briefly flashes a full-screen marker when the admin sends "Identify".
    var identifyFlash = false

    /// What this unit is currently playing, surfaced in the admin dashboard. Set
    /// by the player; reported on every heartbeat so it clears when playback ends.
    private(set) var nowPlaying: HeartbeatRequest.NowPlaying?

    let identity: DeviceIdentity
    let management: ManagementClient
    private var loopTask: Task<Void, Never>?
    private var nowPlayingBeatTask: Task<Void, Never>?
    private var heartbeatFailures = 0

    /// True after a connection attempt failed to reach the management server.
    /// Drives the "Failed to connect to server" message on the connection screen.
    private(set) var connectionFailed = false
    private var attempting = false

    /// Bumped by the "reload" command so the home re-fetches its shelves.
    private(set) var reloadToken = 0

    private let heartbeatInterval: Duration = .seconds(30)
    private let retryInterval: Duration = .seconds(8)
    private let failuresBeforeBlock = 3

    var theme: Theme { Theme(appearance: config.appearance) }

    var homeLibrary: BaseItem? {
        guard let id = config.browse.homeLibraryId else { return nil }
        return libraries.first { $0.id == id }
    }

    /// The container to show at the folder-browser root. Prefer an explicitly
    /// configured home library; otherwise, when the unit has exactly one library,
    /// drill straight into it — a single-tile grid would just repeat the app title
    /// (e.g. an app titled "Jellyfin" over a lone library also named "Jellyfin").
    /// Returns nil to show the multi-library grid.
    var rootLibrary: BaseItem? {
        if let home = homeLibrary { return home }
        return libraries.count == 1 ? libraries.first : nil
    }

    init() {
        let id = DeviceIdentity.shared
        self.identity = id
        self.management = ManagementClient(identity: id)
        // Start from a neutral placeholder; real config only ever comes from the server.
        self.config = UnitConfig.placeholder(unitId: id.unitId)
    }

    // MARK: - Lifecycle

    func start() async {
        await refreshFromServer(initial: true)
        startLoop()
    }

    func retry() {
        Task { await refreshFromServer(initial: true) }
    }

    /// Registers (first launch) or fetches the latest config, then connects.
    /// On ANY failure to reach the management server the app is blocked — there is
    /// no cached fallback.
    func refreshFromServer(initial: Bool) async {
        if initial { phase = .registering }
        await attemptConnect()
    }

    /// Points this unit at a (possibly new) management server and tries to connect.
    /// Used by the connection screen, which shows inline progress and, on failure,
    /// the "Failed to connect to server" message. The global phase is left on the
    /// connection screen during the attempt (no splash flash).
    func connect(to url: String) async {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if trimmed != identity.managementBaseURL {
            identity.deviceToken = nil // re-register against the new server
        }
        identity.managementBaseURL = trimmed
        await attemptConnect()
    }

    /// The core management-server handshake. On success it connects to Jellyfin;
    /// on any failure to reach the server it blocks and flags `connectionFailed`.
    private func attemptConnect() async {
        if attempting { return }
        attempting = true
        defer { attempting = false }
        do {
            let newConfig: UnitConfig
            if identity.deviceToken == nil {
                newConfig = try await management.register()
            } else {
                newConfig = try await management.fetchConfig()
            }
            heartbeatFailures = 0
            connectionFailed = false
            await apply(newConfig, force: true)
        } catch {
            connectionFailed = true
            phase = .needsManagementServer
        }
    }

    /// Applies a server-provided config and (re)connects to Jellyfin if needed.
    private func apply(_ newConfig: UnitConfig, force: Bool = false) async {
        let changed = newConfig != config
        guard force || changed || jellyfin == nil else {
            config = newConfig
            return
        }
        await establishJellyfin(using: newConfig, soft: phase == .ready)
    }

    /// Reconnects to Jellyfin using the current config (e.g. the "reload" command).
    private func connectJellyfin() async {
        await establishJellyfin(using: config, soft: phase == .ready)
    }

    /// Connects to Jellyfin with `newConfig`. A **soft** reconnect (used when the
    /// app is already showing content and a config change arrives) keeps the
    /// current UI on screen during the handshake and only swaps in the new
    /// client/config once it's ready — so the home never tears down or flashes
    /// empty. A non-soft connect shows the "Loading content…" splash (first launch
    /// or recovering from a blocked state).
    private func establishJellyfin(using newConfig: UnitConfig, soft: Bool) async {
        guard newConfig.isJellyfinConfigured else {
            config = newConfig
            jellyfin = nil
            libraries = []
            phase = .waitingForContent
            return
        }
        if !soft { phase = .connectingJellyfin }
        guard let client = JellyfinClient(
            config: newConfig.jellyfin,
            deviceId: identity.unitId,
            deviceName: identity.deviceName,
            appVersion: identity.appVersion
        ) else {
            config = newConfig
            phase = .error("The Jellyfin server address for this unit is invalid.")
            return
        }
        do {
            try await client.authenticate()
            let views = try await client.userViews()
            self.jellyfin = client
            self.libraries = filteredLibraries(views, browse: newConfig.browse)
            config = newConfig // expose the new configVersion only after the client is ready
            phase = .ready
        } catch {
            config = newConfig
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            phase = .error(message)
            Task { try? await management.heartbeat(lastError: message) }
        }
    }

    private func filteredLibraries(_ views: [BaseItem], browse: UnitConfig.Browse) -> [BaseItem] {
        let hidden = Set(browse.hiddenLibraryIds)
        var result = views.filter { !hidden.contains($0.id) }
        if browse.mode == .curated, !browse.allowedLibraryIds.isEmpty {
            let allowed = Set(browse.allowedLibraryIds)
            result = result.filter { allowed.contains($0.id) }
        }
        return result
    }

    // MARK: - Background loop (heartbeat when connected, retry when blocked)

    private func startLoop() {
        loopTask?.cancel()
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = (self?.phase == .ready || self?.phase == .waitingForContent)
                    ? (self?.heartbeatInterval ?? .seconds(30))
                    : (self?.retryInterval ?? .seconds(8))
                try? await Task.sleep(for: interval)
                if Task.isCancelled { break }
                await self?.tick()
            }
        }
    }

    private func tick() async {
        switch phase {
        case .ready, .waitingForContent:
            await beat()
        case .needsManagementServer, .error:
            // Keep trying to reach the server; recover automatically when it returns.
            await refreshFromServer(initial: false)
        case .launching, .registering, .connectingJellyfin:
            break // an attempt is already in flight
        }
    }

    private func beat() async {
        do {
            // Report current status: a successful beat only happens from a healthy
            // state, so `lastError` is nil (clearing any stale failure such as the
            // bad-credentials message), and `nowPlaying` reflects what's playing
            // right now (clearing a finished item).
            let response = try await management.heartbeat(nowPlaying: nowPlaying)
            heartbeatFailures = 0
            if response.configVersion != config.configVersion {
                let newConfig = try await management.fetchConfig()
                await apply(newConfig)
            }
            if let command = response.command {
                await handle(command)
            }
        } catch {
            heartbeatFailures += 1
            // The server went away — block until it comes back (no offline operation).
            if heartbeatFailures >= failuresBeforeBlock {
                phase = .needsManagementServer
            }
        }
    }

    private func handle(_ command: DeviceCommand) async {
        switch command.type {
        case "reload":
            reloadToken += 1
            await connectJellyfin()
        case "restart":
            await refreshFromServer(initial: false)
        case "identify":
            await flashIdentify()
        case "migrate":
            await migrate(to: command.data, commandId: command.id)
            return // migrate acks the old server itself before switching
        default:
            break
        }
        try? await management.ack(commandId: command.id)
    }

    /// "Move to new server": ack on the current server, then re-point this unit at
    /// the new management server URL and reconnect with its existing identity — no
    /// re-adoption when the new server has the migrated records.
    private func migrate(to url: String?, commandId: String) async {
        try? await management.ack(commandId: commandId) // ack the OLD server first
        let trimmed = url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return }
        identity.managementBaseURL = trimmed
        await refreshFromServer(initial: false)
    }

    /// Called by the player to publish (or clear) what this unit is playing. Pushes
    /// an immediate heartbeat so the dashboard updates without waiting for the loop.
    /// A new call supersedes a still-pending one (cancel-then-replace) so a rapid
    /// start→stop can't leave a stale "now playing" from an out-of-order report.
    func setNowPlaying(_ value: HeartbeatRequest.NowPlaying?) {
        nowPlaying = value
        nowPlayingBeatTask?.cancel()
        nowPlayingBeatTask = Task { [weak self] in
            guard let self else { return }
            try? await self.management.heartbeat(nowPlaying: value)
        }
    }

    private func flashIdentify() async {
        identifyFlash = true
        try? await Task.sleep(for: .seconds(6))
        identifyFlash = false
    }
}
