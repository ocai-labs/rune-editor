// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The PM node name AND public `type` identifier for the in-document page
// title (block 0 of the document). Lives in its own module so the block,
// the boundary extension, and the public re-export all read one constant
// without a cycle.
export const TITLE_TYPE = "title"
