// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, vi, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { AudioPlayer } from "./AudioPlayer"

afterEach(cleanup)

describe("AudioPlayer", () => {
  it("reverts to 'Play' when audio.play() rejects (autoplay policy)", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockReturnValue(Promise.reject(new DOMException("blocked", "NotAllowedError")))
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})

    render(<AudioPlayer src="/test.mp3" />)
    fireEvent.click(screen.getByRole("button", { name: /play/i }))
    expect(playSpy).toHaveBeenCalledTimes(1)

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument(),
    )
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument()

    playSpy.mockRestore()
  })
})
