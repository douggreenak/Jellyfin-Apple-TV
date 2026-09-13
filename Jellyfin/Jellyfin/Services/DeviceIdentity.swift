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

    /// Base address of the management server, e.g. "http://localhost:4000".
    /// Defaults to localhost (which, on the tvOS Simulator, is the Mac host).
    var managementBaseURL: String {
        get { defaults.string(forKey: Keys.managementURL) ?? "http://localhost:4000" }
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

    var tvosVersion: String {
        #if canImport(UIKit)
        return UIDevice.current.systemVersion
        #else
        return ""
        #endif
    }

    /// "1.0 (42)" — marketing version + build number. `scripts/build-ipa.sh` stamps a
    /// fresh, monotonically-increasing build number (git commit count) into every Ad
    /// Hoc export, so this string changes on every real build even when the marketing
    /// version (bumped by hand, occasionally) doesn't. Reported at register and on
    /// every heartbeat so the management server can tell which build a unit is
    /// actually running, and flag units that are behind the fleet's latest.
    var appVersion: String {
        let info = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(marketing) (\(build))"
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
