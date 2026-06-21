//
//  MediaCards.swift
//  Jellyfin
//
//  The focusable tiles in the folder browser: portrait posters, 16:9 landscape
//  cards (episodes), and library tiles. All use the tvOS `.card` button style for
//  the signature focus lift, with the title rendered statically below.
//

import SwiftUI

// MARK: - Shared pieces

struct PlaceholderTile: View {
    var systemImage: String = "film"
    var body: some View {
        ZStack {
            Rectangle().fill(
                LinearGradient(colors: [Color.white.opacity(0.10), Color.white.opacity(0.03)],
                               startPoint: .top, endPoint: .bottom)
            )
            Image(systemName: systemImage)
                .font(.system(size: 52))
                .foregroundStyle(.tertiary)
        }
    }
}

struct ProgressBar: View {
    let progress: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(.black.opacity(0.45))
                Rectangle().fill(.white)
                    .frame(width: geo.size.width * min(max(progress, 0), 1))
            }
        }
        .frame(height: 6)
    }
}

struct CardCaption: View {
    let title: String
    var subtitle: String?
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.callout.weight(.medium))
                .lineLimit(1)
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: width, alignment: .leading)
    }
}

// MARK: - Poster card (2:3)

struct PosterCard: View {
    let item: BaseItem
    var showTitle: Bool = true

    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: item) { poster }
                .buttonStyle(.card)
            if showTitle {
                CardCaption(title: item.name, subtitle: item.cardSubtitle, width: theme.posterWidth)
            }
        }
    }

    private var poster: some View {
        ZStack(alignment: .bottom) {
            CachedAsyncImage(url: model.jellyfin?.imageURL(for: item, maxHeight: 540)) {
                PlaceholderTile(systemImage: item.systemImageName)
            }
            .frame(width: theme.posterWidth, height: theme.posterHeight)
            .clipped()
            if let p = item.userData?.progress, p > 0.01, p < 0.99 {
                ProgressBar(progress: p)
            }
        }
        .frame(width: theme.posterWidth, height: theme.posterHeight)
    }
}

// MARK: - Landscape card (16:9) — episodes / wide thumbnails

struct LandscapeCard: View {
    let item: BaseItem

    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: item) { thumb }
                .buttonStyle(.card)
            CardCaption(title: titleText, subtitle: subtitleText, width: theme.landscapeWidth)
        }
    }

    private var thumb: some View {
        ZStack(alignment: .bottom) {
            CachedAsyncImage(url: model.jellyfin?.wideImageURL(for: item, maxWidth: 700)) {
                PlaceholderTile(systemImage: item.systemImageName)
            }
            .frame(width: theme.landscapeWidth, height: theme.landscapeHeight)
            .clipped()
            if let p = item.userData?.progress, p > 0.01, p < 0.99 {
                ProgressBar(progress: p)
            }
        }
        .frame(width: theme.landscapeWidth, height: theme.landscapeHeight)
    }

    private var titleText: String {
        item.type == "Episode" ? (item.seriesName ?? item.name) : item.name
    }

    private var subtitleText: String? {
        if item.type == "Episode" {
            var parts: [String] = []
            if let label = item.episodeLabel { parts.append(label) }
            parts.append(item.name)
            return parts.joined(separator: " · ")
        }
        return item.cardSubtitle
    }
}

// MARK: - Library tile (16:9 with name overlay)

struct LibraryCard: View {
    let item: BaseItem

    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    var body: some View {
        NavigationLink(value: item) {
            ZStack(alignment: .bottomLeading) {
                CachedAsyncImage(url: model.jellyfin?.wideImageURL(for: item, maxWidth: 700)) {
                    PlaceholderTile(systemImage: item.systemImageName)
                }
                .frame(width: theme.libraryCardWidth, height: theme.libraryCardHeight)
                .clipped()

                LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .center, endPoint: .bottom)

                HStack(spacing: 12) {
                    Image(systemName: item.systemImageName)
                        .font(.title3)
                    Text(item.name)
                        .font(.title3.bold())
                        .lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(18)
            }
            .frame(width: theme.libraryCardWidth, height: theme.libraryCardHeight)
        }
        .buttonStyle(.card)
    }
}
