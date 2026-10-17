package syncengine

// Windows has no filesystem FIFOs. The authorized root must reject escaping
// reparse points; portable names reject drive/device/ADS syntax before any open.
const s3AttachmentPlatform = true
const s3AttachmentOpenFlags = 0
