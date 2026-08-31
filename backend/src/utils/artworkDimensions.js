// Print size of an artwork file, read from the image itself.
//
// The order and quotation screens show "22 x 79 in" next to a picture the
// moment it is attached. That number comes from the pixel size divided by the
// file's DPI — 300 when the file carries no density, which is the shop's print
// default. Extracted from the upload route so a file picked out of Google
// Drive is measured exactly the same way as one uploaded from a desktop.

const sharp = require('sharp')

const DEFAULT_PRINT_DPI = 300

function formatInches(value) {
  return Number(value.toFixed(2)).toString()
}

async function readArtworkDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata()
    if (!metadata.width || !metadata.height) return null

    const embeddedDpi = Number(metadata.density)
    const dpi = Number.isFinite(embeddedDpi) && embeddedDpi > 0 ? embeddedDpi : DEFAULT_PRINT_DPI
    const widthInches = metadata.width / dpi
    const heightInches = metadata.height / dpi

    return {
      width_px: metadata.width,
      height_px: metadata.height,
      dpi,
      dpi_source: embeddedDpi > 0 ? 'embedded' : 'default_300',
      width_inches: Number(widthInches.toFixed(2)),
      height_inches: Number(heightInches.toFixed(2)),
      artwork_size: `${formatInches(widthInches)} x ${formatInches(heightInches)} in`,
    }
  } catch {
    return null
  }
}

module.exports = { readArtworkDimensions, DEFAULT_PRINT_DPI }
