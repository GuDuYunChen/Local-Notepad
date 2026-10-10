//go:build linux || darwin || freebsd

package syncengine

import "syscall"

const s3AttachmentPlatform = true
const s3AttachmentOpenFlags = syscall.O_NOFOLLOW | syscall.O_NONBLOCK
