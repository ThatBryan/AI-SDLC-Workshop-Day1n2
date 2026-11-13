export function getTagTextColor(background: string): '#000000' | '#FFFFFF' {
  if (!/^#[0-9A-Fa-f]{6}$/.test(background)) {
    throw new RangeError('Tag color must be a six-digit hex value');
  }

  const linearChannel = (start: number) => {
    const channel = Number.parseInt(background.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearChannel(1) +
    0.7152 * linearChannel(3) +
    0.0722 * linearChannel(5);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);

  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}
