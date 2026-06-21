//
//  JellyfinModels.swift
//  Jellyfin
//
//  Codable models for the subset of the Jellyfin REST API the app uses.
//  Jellyfin returns PascalCase keys; CodingKeys map them to Swift names.
//

import Foundation

// MARK: - Authentication

struct JellyfinAuthRequest: Encodable {
    let Username: String
    let Pw: String
}

struct JellyfinAuthResponse: Decodable {
    let accessToken: String
    let serverId: String?
    let user: JellyfinUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "AccessToken"
        case serverId = "ServerId"
        case user = "User"
    }
}

struct JellyfinUser: Decodable, Identifiable {
    let id: String
    let name: String

    enum CodingKeys: String, CodingKey {
        case id = "Id"
        case name = "Name"
    }
}

struct JellyfinSystemInfo: Decodable {
    let serverName: String?
    let version: String?

    enum CodingKeys: String, CodingKey {
        case serverName = "ServerName"
        case version = "Version"
    }
}

// MARK: - Items

struct ItemsResponse: Decodable {
    let items: [BaseItem]
    let totalRecordCount: Int?

    enum CodingKeys: String, CodingKey {
        case items = "Items"
        case totalRecordCount = "TotalRecordCount"
    }
}

/// A library, folder, collection, movie, series, season, or episode.
struct BaseItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: String?
    let collectionType: String?
    let isFolder: Bool?
    let overview: String?
    let productionYear: Int?
    let runTimeTicks: Int64?
    let indexNumber: Int?
    let parentIndexNumber: Int?
    let seriesName: String?
    let childCount: Int?
    let primaryImageAspectRatio: Double?
    let imageTags: [String: String]?
    let backdropImageTags: [String]?
    let userData: UserItemData?
    let genres: [String]?
    let communityRating: Double?
    let officialRating: String?
    let seriesId: String?
    let parentBackdropItemId: String?
    let parentBackdropImageTags: [String]?
    let parentThumbItemId: String?
    let parentThumbImageTag: String?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id = "Id"
        case name = "Name"
        case type = "Type"
        case collectionType = "CollectionType"
        case isFolder = "IsFolder"
        case overview = "Overview"
        case productionYear = "ProductionYear"
        case runTimeTicks = "RunTimeTicks"
        case indexNumber = "IndexNumber"
        case parentIndexNumber = "ParentIndexNumber"
        case seriesName = "SeriesName"
        case childCount = "ChildCount"
        case primaryImageAspectRatio = "PrimaryImageAspectRatio"
        case imageTags = "ImageTags"
        case backdropImageTags = "BackdropImageTags"
        case userData = "UserData"
        case genres = "Genres"
        case communityRating = "CommunityRating"
        case officialRating = "OfficialRating"
        case seriesId = "SeriesId"
        case parentBackdropItemId = "ParentBackdropItemId"
        case parentBackdropImageTags = "ParentBackdropImageTags"
        case parentThumbItemId = "ParentThumbItemId"
        case parentThumbImageTag = "ParentThumbImageTag"
        case status = "Status"
    }

    static func == (lhs: BaseItem, rhs: BaseItem) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    // MARK: Convenience

    /// Whether this item is a container the user can drill into.
    var isContainer: Bool {
        if let isFolder { return isFolder }
        switch type {
        case "Folder", "CollectionFolder", "Series", "Season", "BoxSet", "MusicAlbum", "Playlist":
            return true
        default:
            return false
        }
    }

    /// Whether this item can be played directly.
    var isPlayable: Bool {
        switch type {
        case "Movie", "Episode", "Video", "MusicVideo", "TvChannel", "Trailer":
            return true
        default:
            return !isContainer
        }
    }

    var primaryImageTag: String? { imageTags?["Primary"] }
    var thumbImageTag: String? { imageTags?["Thumb"] }

    /// Runtime formatted like "24 min".
    var runtimeText: String? {
        guard let ticks = runTimeTicks, ticks > 0 else { return nil }
        let minutes = Int(ticks / 600_000_000) // 10,000,000 ticks/sec * 60
        if minutes < 1 { return "Under a minute" }
        if minutes < 60 { return "\(minutes) min" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }

    /// "S1 · E4" style label for episodes.
    var episodeLabel: String? {
        guard type == "Episode" else { return nil }
        var parts: [String] = []
        if let s = parentIndexNumber { parts.append("S\(s)") }
        if let e = indexNumber { parts.append("E\(e)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// SF Symbol used as the placeholder / fallback icon for this item.
    var systemImageName: String {
        switch collectionType {
        case "movies": return "film.stack"
        case "tvshows": return "tv"
        case "music": return "music.note"
        case "books": return "books.vertical"
        case "homevideos", "photos": return "photo.on.rectangle"
        case "playlists": return "music.note.list"
        case "boxsets": return "rectangle.stack"
        default: break
        }
        switch type {
        case "Series": return "tv"
        case "Season": return "rectangle.stack"
        case "Episode": return "play.rectangle.fill"
        case "Movie": return "film"
        case "Folder", "CollectionFolder": return "folder.fill"
        case "BoxSet": return "rectangle.stack"
        default: return isContainer ? "folder.fill" : "play.circle.fill"
        }
    }

    /// Community rating like "8.4".
    var ratingText: String? {
        guard let r = communityRating, r > 0 else { return nil }
        return String(format: "%.1f", r)
    }

    /// Up to three genres, e.g. "Animation · Comedy".
    var genreText: String? {
        guard let genres, !genres.isEmpty else { return nil }
        return genres.prefix(3).joined(separator: " · ")
    }

    /// Short secondary line used beneath cards (no publish year by design).
    var cardSubtitle: String? {
        if let label = episodeLabel { return label }
        if type == "Episode", let series = seriesName { return series }
        if isContainer, let count = childCount, count > 0 {
            return count == 1 ? "1 item" : "\(count) items"
        }
        return nil
    }

    /// Metadata chips for the detail screen.
    var detailMetadata: [String] {
        var parts: [String] = []
        if let label = episodeLabel { parts.append(label) }
        if let year = productionYear { parts.append(String(year)) }
        if let runtime = runtimeText { parts.append(runtime) }
        if let cert = officialRating, !cert.isEmpty { parts.append(cert) }
        if let rating = ratingText { parts.append("★ \(rating)") }
        return parts
    }

    /// Whether playback should offer "Resume" (partially watched).
    var isResumable: Bool {
        if let p = userData?.progress { return p > 0.01 && p < 0.95 }
        return false
    }

    /// Resume position in seconds, if any.
    var resumeSeconds: Double {
        guard let ticks = userData?.playbackPositionTicks, ticks > 0 else { return 0 }
        return Double(ticks) / 10_000_000.0
    }
}

struct UserItemData: Decodable, Hashable {
    let playedPercentage: Double?
    let played: Bool?
    let playbackPositionTicks: Int64?

    enum CodingKeys: String, CodingKey {
        case playedPercentage = "PlayedPercentage"
        case played = "Played"
        case playbackPositionTicks = "PlaybackPositionTicks"
    }

    /// 0...1 progress for the resume bar, if any.
    var progress: Double? {
        if let pct = playedPercentage { return min(max(pct / 100, 0), 1) }
        return nil
    }
}
