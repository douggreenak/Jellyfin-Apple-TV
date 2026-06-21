//
//  Components.swift
//  Jellyfin
//
//  Reusable, Apple-TV-styled building blocks: poster cards, section headers,
//  the clock, and loading / error states.
//

import SwiftUI

// MARK: - Loading

struct LoadingView: View {
    var label: String? = nil
    var body: some View {
        VStack(spacing: 24) {
            ProgressView()
                .controlSize(.large)
            if let label {
                Text(label)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error

struct ErrorView: View {
    let title: String
    let message: String
    var systemImage: String = "exclamationmark.triangle.fill"
    var retryTitle: String = "Try Again"
    var retry: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: systemImage)
                .font(.system(size: 90))
                .foregroundStyle(.yellow)
            VStack(spacing: 12) {
                Text(title)
                    .font(.title.bold())
                Text(message)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 900)
            }
            if let retry {
                Button(retryTitle, action: retry)
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(80)
    }
}

// MARK: - Clock

struct ClockView: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(context.date, format: .dateTime.hour().minute())
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Section header

struct SectionHeaderView: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title2.bold())
            if let subtitle {
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Poster image

/// The visual of a poster/thumbnail tile (no interaction). Wrap it in a
/// `NavigationLink { … }.buttonStyle(.card)` to get the tvOS focus "lift".
struct PosterImageView: View {
    let url: URL?
    let width: CGFloat
    let height: CGFloat
    var progress: Double? = nil
    var systemPlaceholder: String = "film"

    var body: some View {
        ZStack(alignment: .bottom) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                case .empty:
                    placeholder.overlay(ProgressView())
                case .failure:
                    placeholder
                @unknown default:
                    placeholder
                }
            }
            .frame(width: width, height: height)
            .clipped()

            if let progress, progress > 0.01 {
                ZStack(alignment: .leading) {
                    Rectangle().fill(.ultraThinMaterial)
                    GeometryReader { geo in
                        Rectangle()
                            .fill(.white)
                            .frame(width: geo.size.width * progress)
                    }
                }
                .frame(height: 8)
            }
        }
        .frame(width: width, height: height)
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(.quaternary)
            Image(systemName: systemPlaceholder)
                .font(.system(size: 56))
                .foregroundStyle(.tertiary)
        }
    }
}
