//
//  UnitConfig.swift
//  Jellyfin
//
//  The canonical per-unit configuration. The management server is the source of
//  truth; this struct mirrors docs/UNIT_CONFIG_SCHEMA.json. The server always
//  returns complete, validated config objects, so synthesized Codable is used.
//

import Foundation

struct UnitConfig: Codable, Equatable {
    var unitId: String
    var displayName: String
    var groupId: String?
    var jellyfin: Jellyfin
    var browse: Browse
    var appearance: Appearance
    var playback: Playback
    var configVersion: Int
    var updatedAt: String

    struct Jellyfin: Codable, Equatable {
        var serverUrl: String
        var username: String
        var password: String

        init(serverUrl: String = "", username: String = "", password: String = "") {
            self.serverUrl = serverUrl
            self.username = username
            self.password = password
        }
    }

    enum BrowseMode: String, Codable, CaseIterable {
        case full, curated, kiosk
        var label: String {
            switch self {
            case .full: return "Full browse"
            case .curated: return "Curated"
            case .kiosk: return "Kiosk"
            }
        }
    }

    struct Browse: Codable, Equatable {
        var mode: BrowseMode
        var homeLibraryId: String?
        var allowedLibraryIds: [String]
        var hiddenLibraryIds: [String]

        init(mode: BrowseMode = .full, homeLibraryId: String? = nil,
             allowedLibraryIds: [String] = [], hiddenLibraryIds: [String] = []) {
            self.mode = mode
            self.homeLibraryId = homeLibraryId
            self.allowedLibraryIds = allowedLibraryIds
            self.hiddenLibraryIds = hiddenLibraryIds
        }
    }

    enum Theme: String, Codable, CaseIterable {
        case system, light, dark
        var label: String { rawValue.capitalized }
    }

    enum PosterStyle: String, Codable, CaseIterable {
        case poster, thumb, wide
        /// width / height for the card.
        var aspectRatio: CGFloat {
            switch self {
            case .poster: return 2.0 / 3.0
            case .thumb:  return 1.0
            case .wide:   return 16.0 / 9.0
            }
        }
        var label: String {
            switch self {
            case .poster: return "Poster (tall)"
            case .thumb:  return "Square"
            case .wide:   return "Wide (16:9)"
            }
        }
    }

    struct Appearance: Codable, Equatable {
        var appTitle: String
        var theme: Theme
        var accentColorHex: String
        var showClock: Bool
        var showItemTitles: Bool
        var posterStyle: PosterStyle

        init(appTitle: String = "Jellyfin", theme: Theme = .dark,
             accentColorHex: String = "#5E5CE6", showClock: Bool = true,
             showItemTitles: Bool = true, posterStyle: PosterStyle = .wide) {
            self.appTitle = appTitle
            self.theme = theme
            self.accentColorHex = accentColorHex
            self.showClock = showClock
            self.showItemTitles = showItemTitles
            self.posterStyle = posterStyle
        }
    }

    struct Playback: Codable, Equatable {
        var autoplayNext: Bool
        var maxBitrateMbps: Double
        var preferDirectPlay: Bool

        init(autoplayNext: Bool = true, maxBitrateMbps: Double = 0, preferDirectPlay: Bool = true) {
            self.autoplayNext = autoplayNext
            self.maxBitrateMbps = maxBitrateMbps
            self.preferDirectPlay = preferDirectPlay
        }
    }

    init(unitId: String,
         displayName: String = "New Apple TV",
         groupId: String? = nil,
         jellyfin: Jellyfin = Jellyfin(),
         browse: Browse = Browse(),
         appearance: Appearance = Appearance(),
         playback: Playback = Playback(),
         configVersion: Int = 1,
         updatedAt: String = "") {
        self.unitId = unitId
        self.displayName = displayName
        self.groupId = groupId
        self.jellyfin = jellyfin
        self.browse = browse
        self.appearance = appearance
        self.playback = playback
        self.configVersion = configVersion
        self.updatedAt = updatedAt
    }

    /// A safe placeholder used before the server has been reached.
    static func placeholder(unitId: String) -> UnitConfig {
        UnitConfig(unitId: unitId, displayName: "Apple TV")
    }

    var isJellyfinConfigured: Bool {
        !jellyfin.serverUrl.trimmingCharacters(in: .whitespaces).isEmpty && !jellyfin.username.isEmpty
    }
}
