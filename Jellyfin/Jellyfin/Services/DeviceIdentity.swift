//
//  DeviceIdentity.swift
//  Jellyfin
//
//  Stable per-install identity (unitId), the device token issued by the
//  management server, and the address of that server. Persisted in UserDefaults.
//

import Foundation
#if canImport(UIKit)
import UIKit
#endif

final class DeviceIdentity {
    static let shared = DeviceIdentity()

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let unitId = "kc.unitId"
        static let deviceToken = "kc.deviceToken"
        static let managementURL = "kc.managementURL"
    }

    /// Stable UUID for this install. Created once, then reused forever.
    let unitId: String

    private init() {
        if let existing = defaults.string(forKey: Keys.unitId), !existing.isEmpty {
            unitId = existing
        } else {
            let generated = UUID().uuidString
            defaults.set(generated, forKey: Keys.unitId)
            unitId = generated
        }
    }

    /// Token issued by the management server at registration.
    var deviceToken: String? {
        get { defaults.string(forKey: Keys.deviceToken) }
        set { defaults.set(newValue, forKey: Keys.deviceToken) }
    }

    /// Base address of the management server. Defaults to the fleet's Linux box on
    /// the church network, so a fresh Apple TV finds it with zero manual setup —
    /// only the Simulator or an off-site unit would ever need to type a different
    /// one on the "management server required" screen.
    var managementBaseURL: String {
        get { defaults.string(forKey: Keys.managementURL) ?? "http://172.16.50.100:4000" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespaces), forKey: Keys.managementURL) }
    }

    // MARK: - Device facts (sent to the management server)

    var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "Apple TV"
        #endif
    }

    /// This device's real, user-assigned name recovered via Bonjour (see
    /// LocalDeviceNameResolver), if resolution has succeeded this session.
    /// `deviceName`/`UIDevice.current.name` is gated by Apple and normally
    /// just returns "Apple TV", so this is what actually distinguishes one
    /// unit from another when reported to the server. `nil` until
    /// `refreshLocalName()` resolves it (or if it never does — an unattended
    /// unit whose Local Network permission prompt nobody has answered, for
    /// instance); callers should treat that as "nothing better available."
    private(set) var localName: String?

    /// Kicks off Bonjour resolution in the background and caches the result
    /// for the rest of this process's lifetime. Safe to call repeatedly
    /// (e.g. once per app launch) — a no-op once `localName` is already set,
    /// and a bounded, always-completing best-effort attempt otherwise (see
    /// LocalDeviceNameResolver's own doc comment for why this can't be
    /// guaranteed to succeed).
    func refreshLocalName() {
        guard localName == nil else { return }
        Task { [weak self] in
            guard let name = await LocalDeviceNameResolver.resolve() else { return }
            self?.localName = name
        }
    }

    var tvosVersion: String {
        #if canImport(UIKit)
        return UIDevice.current.systemVersion
        #else
        return ""
        #endif
    }

    /// "1.32" — just the marketing version. `scripts/build-ipa.sh` stamps
    /// `MARKETING_VERSION="1.<git commit count>"` into every Ad Hoc export, so this
    /// already changes on every real build — no separate "(build)" parenthetical
    /// needed (the old "1.0 (42)" format this replaced always looked frozen at "1.0"
    /// with the real counter hidden in parentheses). Reported at register and on
    /// every heartbeat so the management server can tell which build a unit is
    /// actually running, and flag units that are behind the fleet's latest.
    var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    /// Hardware identifier such as "AppleTV14,1".
    var hardwareModel: String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let mirror = Mirror(reflecting: sysinfo.machine)
        let id = mirror.children.reduce(into: "") { acc, element in
            if let value = element.value as? Int8, value != 0 {
                acc.append(Character(UnicodeScalar(UInt8(value))))
            }
        }
        return id.isEmpty ? "AppleTV" : id
    }
}
