//
//  NetworkInfo.swift
//  Jellyfin
//
//  This device's own local IPv4 address, for the identify overlay. Uses the
//  standard BSD `getifaddrs` API — no special entitlement needed, unlike a real
//  MAC address (categorically unavailable to any third-party app since iOS 7,
//  with no entitlement that unlocks it — see CLAUDE.md's identify-screen note)
//  or Wi-Fi signal strength (needs Apple's `com.apple.developer.networking.wifi-info`
//  entitlement, requested from Apple, which this app doesn't have).
//

import Foundation

enum NetworkInfo {
    /// The first non-loopback, active IPv4 address on any interface (Wi-Fi or
    /// Ethernet — tvOS has no cellular). `nil` if nothing is connected.
    static var localIPAddress: String? {
        var ifaddrPtr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrPtr) == 0, let first = ifaddrPtr else { return nil }
        defer { freeifaddrs(ifaddrPtr) }

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard (flags & (IFF_UP | IFF_RUNNING)) == (IFF_UP | IFF_RUNNING),
                  (flags & IFF_LOOPBACK) == 0,
                  let ifaAddr = ptr.pointee.ifa_addr,
                  ifaAddr.pointee.sa_family == UInt8(AF_INET)
            else { continue }

            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                ifaAddr, socklen_t(ifaAddr.pointee.sa_len),
                &hostname, socklen_t(hostname.count),
                nil, 0, NI_NUMERICHOST
            )
            guard result == 0 else { continue }
            return String(cString: hostname)
        }
        return nil
    }
}
