//
//  Navigation.swift
//  Jellyfin
//
//  Shared navigation routing. Every NavigationStack registers the same
//  destination: folders/libraries drill in, and a playable item opens the player
//  directly (no in-between detail screen).
//

import SwiftUI

struct MediaDestination: View {
    let item: BaseItem

    var body: some View {
        if item.isContainer {
            LibraryFolderView(parent: item)
        } else {
            PlayerView(item: item)
        }
    }
}

extension View {
    /// Attach to a NavigationStack root so `NavigationLink(value: BaseItem)` works.
    func mediaDestinations() -> some View {
        navigationDestination(for: BaseItem.self) { item in
            MediaDestination(item: item)
        }
    }
}
