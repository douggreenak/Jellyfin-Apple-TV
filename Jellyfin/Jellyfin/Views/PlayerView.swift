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

    init(url: URL, startSeconds: Double) {
        player = AVPlayer(url: url)
        player.allowsExternalPlayback = true
        if startSeconds > 0 {
            player.seek(to: CMTime(seconds: startSeconds, preferredTimescale: 600))
        }
        // Prime the pipeline so the first frame decodes & renders, then pause on it.
        observer = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            guard p.timeControlStatus == .playing else { return }
            Task { @MainActor in
                guard let self, !self.didAutoPause else { return }
                self.didAutoPause = true
                self.player.pause()
                self.observer?.invalidate()
                self.observer = nil
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
