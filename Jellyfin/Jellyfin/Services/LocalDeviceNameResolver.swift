//
//  LocalDeviceNameResolver.swift
//  Jellyfin
//
//  Recovers this Apple TV's real, user-assigned name via Bonjour.
//
//  UIDevice.current.name is gated by Apple (tvOS 16+): without the special
//  com.apple.developer.device-information.user-assigned-device-name
//  entitlement — a formal, justification-required Apple application, not
//  something obtainable from code — it returns the generic model name
//  ("Apple TV") to every third-party app. See DeviceIdentity.deviceName.
//
//  Workaround: every Apple device also broadcasts its real name as the
//  Bonjour *instance name* of several standard services it advertises
//  (AirPlay, Companion Link, sleep proxy, remote-control link). This browses
//  those service types, resolves each discovered instance's IP address, and
//  returns the instance name of whichever one matches one of THIS device's
//  own local IP addresses — i.e. "which Bonjour record is ours."
//
//  Needs only the ordinary Local Network permission (Info.plist's
//  NSLocalNetworkUsageDescription + NSBonjourServices declaring exactly
//  these four service types), not the gated device-name entitlement. tvOS
//  prompts for that permission the first time this runs; on an unattended
//  unit nobody answers it, so resolution just keeps failing gracefully
//  (never blocks or crashes) until someone does.
//
//  Best-effort, not guaranteed: a freshly-booted device's own Bonjour
//  records may not have propagated to the network yet, and depending on
//  network topology / tvOS version, none of these services may be
//  advertised at all. Bounded by `timeout`; returns nil on any failure so
//  callers always have a safe fallback (UIDevice.current.name).
//

import Foundation

final class LocalDeviceNameResolver: NSObject {

    /// Bonjour service types whose instance name is the user-assigned device
    /// name. Must match Info.plist's NSBonjourServices exactly, or tvOS
    /// silently omits results for any type not declared there.
    private static let serviceTypes = [
        "_companion-link._tcp.",
        "_airplay._tcp.",
        "_rdlink._tcp.",
        "_sleep-proxy._udp.",
    ]

    /// Tries to resolve this device's real name within `timeout` seconds.
    /// Returns nil on timeout, no match, or permission denial/pending —
    /// callers should fall back to UIDevice.current.name in that case.
    static func resolve(timeout: TimeInterval = 4) async -> String? {
        let selfAddresses = localIPAddresses()
        guard !selfAddresses.isEmpty else { return nil }
        let resolver = LocalDeviceNameResolver(selfAddresses: selfAddresses)
        return await resolver.run(timeout: timeout)
    }

    private let selfAddresses: Set<String>
    private var browsers: [NetServiceBrowser] = []
    private var services: [NetService] = []
    private var continuation: CheckedContinuation<String?, Never>?
    private var finished = false

    private init(selfAddresses: Set<String>) {
        self.selfAddresses = selfAddresses
    }

    private func run(timeout: TimeInterval) async -> String? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            for type in Self.serviceTypes {
                let browser = NetServiceBrowser()
                browser.delegate = self
                browsers.append(browser)
                browser.searchForServices(ofType: type, inDomain: "local.")
            }
            armTimeout(timeout)
        }
    }

    /// Races resolution against a timeout; whichever finishes first wins
    /// (`finish(with:)` only ever takes effect once). Structured-concurrency
    /// sleep instead of a GCD `asyncAfter` closure, which the compiler flags
    /// for capturing this non-Sendable class across an `@Sendable` boundary.
    private func armTimeout(_ timeout: TimeInterval) {
        Task { [self] in
            try? await Task.sleep(for: .seconds(timeout))
            finish(with: nil)
        }
    }

    private func finish(with name: String?) {
        guard !finished else { return }
        finished = true
        for browser in browsers { browser.stop() }
        for service in services { service.stop() }
        browsers.removeAll()
        services.removeAll()
        continuation?.resume(returning: name)
        continuation = nil
    }

    /// This device's own local IPv4/IPv6 addresses, via `getifaddrs` — plain
    /// BSD socket introspection, no special permission needed. Used to spot
    /// which discovered Bonjour record is this device's own.
    private static func localIPAddresses() -> Set<String> {
        var addresses = Set<String>()
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let firstAddr = ifaddrPtr else { return addresses }
        defer { freeifaddrs(ifaddrPtr) }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard (flags & IFF_UP) == IFF_UP, (flags & IFF_LOOPBACK) == 0,
                  let addr = ptr.pointee.ifa_addr else { continue }
            let family = addr.pointee.sa_family
            guard family == sa_family_t(AF_INET) || family == sa_family_t(AF_INET6) else { continue }

            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let len: socklen_t = family == sa_family_t(AF_INET)
                ? socklen_t(MemoryLayout<sockaddr_in>.size)
                : socklen_t(MemoryLayout<sockaddr_in6>.size)
            if getnameinfo(addr, len, &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                addresses.insert(String(cString: hostname))
            }
        }
        return addresses
    }

    /// Extracts a numeric IP string from a resolved `NetService.addresses`
    /// entry (a raw `sockaddr` blob), in the same format `localIPAddresses`
    /// produces, so string equality is enough to compare them.
    private static func ipString(from data: Data) -> String? {
        data.withUnsafeBytes { raw -> String? in
            guard let sa = raw.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return nil }
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(sa, socklen_t(data.count), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 else {
                return nil
            }
            return String(cString: hostname)
        }
    }
}

extension LocalDeviceNameResolver: NetServiceBrowserDelegate {
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard !finished else { return }
        service.delegate = self
        services.append(service)
        service.resolve(withTimeout: 3)
    }
}

extension LocalDeviceNameResolver: NetServiceDelegate {
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard !finished, let addresses = sender.addresses else { return }
        for data in addresses {
            if let address = Self.ipString(from: data), selfAddresses.contains(address) {
                finish(with: sender.name)
                return
            }
        }
    }
}
