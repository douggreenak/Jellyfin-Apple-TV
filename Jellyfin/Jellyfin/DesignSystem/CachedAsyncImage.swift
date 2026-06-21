//
//  CachedAsyncImage.swift
//  Jellyfin
//
//  A lightweight image view with an in-memory cache and a gentle fade-in. Unlike
//  SwiftUI's AsyncImage it doesn't re-fetch on every re-render, which keeps the
//  focus-heavy shelves smooth on Apple TV.
//

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class ImageCache {
    static let shared = ImageCache()
    private let cache = NSCache<NSURL, UIImage>()

    private init() {
        cache.countLimit = 500
    }

    subscript(url: URL) -> UIImage? {
        get { cache.object(forKey: url as NSURL) }
        set {
            if let newValue {
                cache.setObject(newValue, forKey: url as NSURL)
            }
        }
    }
}

struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                placeholder()
            }
        }
        .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else {
            image = nil
            return
        }
        if let cached = ImageCache.shared[url] {
            image = cached
            return
        }
        image = nil
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard !Task.isCancelled, let decoded = UIImage(data: data) else { return }
            ImageCache.shared[url] = decoded
            withAnimation(.easeOut(duration: 0.3)) { image = decoded }
        } catch {
            // Leave the placeholder in place on failure.
        }
    }
}
