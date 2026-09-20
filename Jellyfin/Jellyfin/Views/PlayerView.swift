//
//  PlayerView.swift
//  Jellyfin
//
//  Full-screen AVKit playback, opened directly when a video is tapped. It "starts
//  paused": the pipeline is primed so the first frame renders, then it pauses on
//  that frame (HLS won't decode a frame while paused), and the user presses Play.
//  Resumes from the saved position and reports start/stop to Jellyfin + the
//  management server.
//

import SwiftUI
import AVKit
import AVFoundation

@MainActor
@Observable
final class PlayerController {
    let player: AVPlayer
    private var observer: NSKeyValueObservation?
    private var didAutoPause = false

    /// True once the first frame has actually decoded and the pipeline has been
    /// auto-paused on it, until the user's own first Play press starts real
    /// playback. Drives a large, unmissable "Paused" overlay — AVKit's native
    /// transport UI only shows a small pause glyph, easy to mistake for a stuck
    /// or broken player on first open. Starts `false` (not `true`) so the
    /// overlay doesn't appear while AVKit's own loading/buffering spinner is
    /// still showing for that first frame — the two were overlapping. Goes
    /// false for good once real playback begins; later pauses mid-viewing
    /// don't need the same explanation.
    private(set) var isPrimedPause = false

    init(url: URL, startSeconds: Double) {
        player = AVPlayer(url: url)
        player.allowsExternalPlayback = true
        if startSeconds > 0 {
            player.seek(to: CMTime(seconds: startSeconds, preferredTimescale: 600))
        }
        // Prime the pipeline so the first frame decodes & renders, then pause on
        // it (HLS won't decode a frame while paused). Keep watching after that:
        // the *next* transition to .playing is the user's own Play press, which
        // is when the primed-pause overlay should actually go away.
        observer = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            guard p.timeControlStatus == .playing, let self else { return }
            Task { @MainActor [self] in
                if !self.didAutoPause {
                    self.didAutoPause = true
                    self.player.pause()
                    // The first frame is decoded and on screen now — AVKit's
                    // loading spinner is done, so it's safe to show our own
                    // "Paused" overlay without the two stacking on top of
                    // each other.
                    self.isPrimedPause = true
                } else {
                    self.isPrimedPause = false
                    self.observer?.invalidate()
                    self.observer = nil
                }
            }
        }
        player.play()
    }

    func currentSeconds() -> Double {
        let s = player.currentTime().seconds
        return s.isFinite ? max(0, s) : 0
    }

    func teardown() {
        observer?.invalidate()
        observer = nil
        player.pause()
    }
}

struct PlayerView: View {
    let item: BaseItem

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var controller: PlayerController?
    @State private var failure: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let controller {
                VideoPlayer(player: controller.player)
                    .ignoresSafeArea()
                if controller.isPrimedPause {
                    PausedOverlay(itemName: item.name)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            } else if let failure {
                ErrorView(
                    title: "Can't play this video",
                    message: failure,
                    retryTitle: "Back",
                    retry: { dismiss() }
                )
            } else {
                LoadingView(label: "Loading \(item.name)…")
            }
        }
        .animation(.easeOut(duration: 0.3), value: controller?.isPrimedPause)
        .onAppear(perform: start)
        .onDisappear(perform: stop)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func start() {
        guard let client = model.jellyfin,
              let url = client.playbackURL(for: item, playback: model.config.playback) else {
            failure = "This unit isn't connected to Jellyfin, or the video can't be streamed."
            return
        }
        controller = PlayerController(url: url, startSeconds: item.resumeSeconds)

        let id = item.id
        let startTicks = Int64(item.resumeSeconds * 10_000_000)
        model.setNowPlaying(.init(title: item.name, itemId: id, positionTicks: startTicks))
        Task {
            await client.reportPlaybackStart(itemId: id, positionTicks: startTicks)
        }
    }

    private func stop() {
        let seconds = controller?.currentSeconds() ?? 0
        controller?.teardown()
        controller = nil

        model.setNowPlaying(nil) // clear now-playing in the dashboard

        let positionTicks = Int64(seconds * 10_000_000)
        let id = item.id
        let client = model.jellyfin
        Task {
            await client?.reportPlaybackStopped(itemId: id, positionTicks: positionTicks)
        }
    }
}

/// A large, unmissable "Paused" marker shown only for the initial primed-pause
/// state (see `PlayerController.isPrimedPause`) — AVKit's own transport UI marks
/// this with just a small pause glyph, which reads as a stuck or broken player
/// rather than "this is intentionally waiting for you to press Play."
private struct PausedOverlay: View {
    let itemName: String

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "pause.circle.fill")
                .font(.system(size: 120))
                .symbolRenderingMode(.hierarchical)
            VStack(spacing: 8) {
                Text("Paused")
                    .font(.system(size: 42, weight: .bold))
                Text("Press Play to start \(itemName)")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(.white)
        .padding(60)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 32, style: .continuous))
    }
}
