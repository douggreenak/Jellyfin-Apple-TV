//
//  LibraryView.swift
//  Jellyfin
//
//  The folder browser. `LibrariesView` is the top level (the unit's libraries);
//  `LibraryFolderView` is a folder's / season's contents. Tapping a video routes
//  straight to the player.
//

import SwiftUI

struct LibrariesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: theme.libraryCardWidth, maximum: theme.libraryCardWidth + 80),
                  spacing: 44, alignment: .top)]
    }

    var body: some View {
        ScrollView {
            if model.libraries.isEmpty {
                ContentUnavailableView(
                    "No libraries",
                    systemImage: "rectangle.on.rectangle.slash",
                    description: Text("This unit's Jellyfin account can't see any libraries, or they're all hidden.")
                )
                .frame(minHeight: 600)
            } else {
                LazyVGrid(columns: columns, spacing: 44) {
                    ForEach(model.libraries) { library in
                        LibraryCard(item: library)
                    }
                }
                .padding(.horizontal, theme.screenPadding)
                .padding(.top, 12)
                .padding(.bottom, 80)
            }
        }
        .navigationTitle(model.config.appearance.appTitle)
    }
}

/// A grid of a folder's / season's / collection's children.
struct LibraryFolderView: View {
    let parent: BaseItem

    @Environment(AppModel.self) private var model
    @Environment(\.theme) private var theme

    @State private var items: [BaseItem] = []
    @State private var state: LoadState = .loading

    enum LoadState: Equatable { case loading, loaded, failed(String) }

    private var isEpisodeFolder: Bool { parent.type == "Season" }

    private var columns: [GridItem] {
        let width = isEpisodeFolder ? theme.landscapeWidth : theme.posterWidth
        return [GridItem(.adaptive(minimum: width, maximum: width + 60), spacing: 40, alignment: .top)]
    }

    var body: some View {
        ScrollView {
            switch state {
            case .loading:
                LoadingView(label: "Loading \(parent.name)…").frame(minHeight: 600)
            case .failed(let message):
                ErrorView(title: "Couldn't load this folder", message: message) {
                    Task { await load() }
                }
                .frame(minHeight: 600)
            case .loaded:
                if items.isEmpty {
                    ContentUnavailableView("Nothing here yet", systemImage: "folder",
                                           description: Text("This folder is empty."))
                        .frame(minHeight: 600)
                } else {
                    LazyVGrid(columns: columns, spacing: 44) {
                        ForEach(items) { item in
                            if item.type == "Episode" {
                                LandscapeCard(item: item)
                            } else {
                                PosterCard(item: item)
                            }
                        }
                    }
                    .padding(.horizontal, theme.screenPadding)
                    .padding(.top, 12)
                    .padding(.bottom, 80)
                }
            }
        }
        .navigationTitle(parent.name)
        .task(id: parent.id) { await load() }
    }

    private func load() async {
        state = .loading
        guard let client = model.jellyfin else {
            state = .failed("Not connected to Jellyfin.")
            return
        }
        do {
            items = try await client.items(parentId: parent.id)
            state = .loaded
        } catch {
            state = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
