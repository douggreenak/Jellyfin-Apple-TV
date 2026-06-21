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
