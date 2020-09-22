const vm = new Vue({
  el: '#app',
  data() {
    return {
      hasStarted: false
    }
  },
  methods: {
    getVideoClasses() {
      if (this.hasStarted) {
        return ['video','running']
      }
      return ['video','stopped']
    },
    handleStopClick() {
      client.emit('stadium:close')
      this.hasStarted = false
    },
    handleStartClick() {
      this.hasStarted = true

      const { video } = this.$refs
      video.requestFullscreen()
      video.play()

      client.emit('stadium:open', {}, () => {

        const transceiver = peerConnection.addTransceiver('video', {
          direction: 'recvonly'
        })
        console.log(transceiver)
        
        const keys = new Map()
        function keyHandler (e) {
          video.blur()
          e.preventDefault()
          // Sólo transmitimos las teclas cuándo haya un cambio de estado
          // en caso contrario no tiene sentido.
          const oldState = keys.get(e.code)
          const newState = e.type === 'keydown'
          const isDirty = oldState !== newState
          keys.set(e.code, newState)
          if (isDirty) {
            if (channel.readyState !== 'open') {
              return
            }
            if (e.type === 'keyup') {
              channel.send(`ku ${e.code} ${e.key}`)
            } else {
              channel.send(`kd ${e.code} ${e.key}`)
            }
          }
        }

        const channel = peerConnection.createDataChannel('input')
        channel.onopen = (e) => {
          console.log(e)
          window.addEventListener('keyup', keyHandler)
          window.addEventListener('keydown', keyHandler)
        }
        channel.onmessage = (e) => console.log(e)
        channel.onclose = (e) => {
          console.log(e)
          window.removeEventListener('keyup', keyHandler)
          window.removeEventListener('keydown', keyHandler)
        }

      })
    }
  }
})

const client = io(`ws://${location.host}`, {
  transports: ['websocket']
})

const peerConnection = new RTCPeerConnection()
peerConnection.onnegotiationneeded = async (e) => {
  console.log(e)
  const offer = await peerConnection.createOffer()
  await peerConnection.setLocalDescription(offer)
  client.emit('rtc:offer', offer)
}
peerConnection.ontrack = (e) => {
  console.log(e)
  const { video } = vm.$refs
  const remoteStream = new MediaStream([e.track])
  console.log(remoteStream)
  video.srcObject = remoteStream 
}
peerConnection.onicecandidate = (e) => {
  console.log(e)
  const candidate = e.candidate
  if (candidate) {
    client.emit('rtc:candidate', candidate)
  }
}
peerConnection.onicecandidateerror = (e) => console.log(e)
peerConnection.oniceconnectionstatechange = (e) => console.log(e)
peerConnection.onicegatheringstatechange = (e) => console.log(e)
peerConnection.onsignalingstatechange = (e) => console.log(e)
peerConnection.ondatachannel = (e) => console.log(e)
peerConnection.onaddstream = (e) => console.log(e)
peerConnection.onremovestream = (e) => console.log(e)


client.on('rtc:answer', async (answer) => {
  console.log(answer)
  await peerConnection.setRemoteDescription(answer)
})

client.on('rtc:candidate', (candidate) => {
  console.log(candidate)
  peerConnection.addIceCandidate(candidate)
})

