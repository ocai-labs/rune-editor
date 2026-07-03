// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useRef, useState } from "react"
import { PauseIcon, PlayIcon } from "../../icons"
import { Slider } from "@/components/ui/slider"

interface AudioPlayerProps {
  src: string
  title?: string
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function AudioPlayer({ src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seeking, setSeeking] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => setDuration(audio.duration)
    const onTimeUpdate = () => {
      if (!seeking) setCurrentTime(audio.currentTime)
    }
    const onEnded = () => setPlaying(false)

    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("ended", onEnded)
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("ended", onEnded)
    }
  }, [seeking])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }
  }, [playing])

  const handleSeekChange = useCallback((values: number[]) => {
    const audio = audioRef.current
    const t = values[0] ?? 0
    if (!audio) return
    setSeeking(true)
    audio.currentTime = t
    setCurrentTime(t)
  }, [])

  const handleSeekCommit = useCallback(() => setSeeking(false), [])

  return (
    <div
      className="flex h-[49px] w-full items-center gap-3 overflow-hidden px-3"
      data-rune-audio-player=""
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        className="flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-current"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>

      <Slider
        value={[currentTime]}
        onValueChange={handleSeekChange}
        onValueCommit={handleSeekCommit}
        min={0}
        max={duration || 1}
        step={0.1}
        className="flex-1 [&_[data-slot=slider-range]]:bg-muted-foreground [&_[data-slot=slider-track]]:bg-muted-foreground/20"
      />

      <span className="shrink-0 text-[11px] tabular-nums opacity-60">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
