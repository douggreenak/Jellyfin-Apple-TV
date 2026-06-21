//
//  Theme.swift
//  Jellyfin
//
//  Visual design tokens. The accent color is driven by the unit's configuration
//  so the central admin can re-skin every TV.
//

import SwiftUI

extension Color {
    /// Creates a color from a "#RRGGBB" string, falling back to the default indigo.
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")).uppercased()
        var value: UInt64 = 0
        if cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) {
            let r = Double((value & 0xFF0000) >> 16) / 255.0
            let g = Double((value & 0x00FF00) >> 8) / 255.0
            let b = Double(value & 0x0000FF) / 255.0
            self = Color(red: r, green: g, blue: b)
        } else {
            self = Color(red: 0.369, green: 0.361, blue: 0.902) // #5E5CE6
        }
    }
}

/// Layout + color tokens, recomputed when appearance changes.
struct Theme: Equatable {
    var accent: Color
    var appearance: UnitConfig.Appearance

    init(appearance: UnitConfig.Appearance) {
        self.appearance = appearance
        self.accent = Color(hex: appearance.accentColorHex)
    }

    // Spacing
    let screenPadding: CGFloat = 80
    let sectionSpacing: CGFloat = 56
    let cardSpacing: CGFloat = 40
    let cornerRadius: CGFloat = 14

    // Shelf / hero metrics (Apple-TV layout)
    let posterWidth: CGFloat = 240
    var posterHeight: CGFloat { posterWidth * 1.5 }            // 2:3
    let landscapeWidth: CGFloat = 392
    var landscapeHeight: CGFloat { landscapeWidth * 9 / 16 }   // 16:9
    let libraryCardWidth: CGFloat = 392
    var libraryCardHeight: CGFloat { libraryCardWidth * 9 / 16 }
    let heroHeight: CGFloat = 640
    let shelfItemSpacing: CGFloat = 36
    let rowSpacing: CGFloat = 52

    /// Card width for the configured poster style.
    var cardWidth: CGFloat {
        switch appearance.posterStyle {
        case .poster: return 260
        case .thumb:  return 300
        case .wide:   return 420
        }
    }

    var cardHeight: CGFloat {
        cardWidth / appearance.posterStyle.aspectRatio
    }

    /// A clean, professional near-black backdrop behind the whole app (no color
    /// wash) — a subtle vertical gradient for depth, like a native tvOS app.
    var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(white: 0.12),
                Color(white: 0.05),
                Color.black
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    var preferredColorScheme: ColorScheme? {
        switch appearance.theme {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

private struct ThemeKey: EnvironmentKey {
    static let defaultValue = Theme(appearance: UnitConfig.Appearance())
}

extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}
