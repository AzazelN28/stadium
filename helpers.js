function swapChannels(buffer) {
  for (let i = 0; i < buffer.length; i += 4) {
    const tmp = buffer[i]
    buffer[i] = buffer[i + 2]
    buffer[i + 2] = tmp
  }
  return buffer
}

module.exports = {
  swapChannels
}
