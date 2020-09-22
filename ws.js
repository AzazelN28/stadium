const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const io = require('socket.io')
const robot = require('robot-js')
const wrtc = require('wrtc')
const { RTCPeerConnection, MediaStream } = wrtc
const { RTCVideoSource, RTCAudioSource, rgbaToI420, rgbToI420 } = wrtc.nonstandard
const debug = require('debug')
const keyCodes = require('./keys')
const config = require('./config')
const { swapChannels } = require('./helpers')
const log = debug('stadium:ws')
const sessions = new Map()

/**
 * Esta es la función encargada de crear el servidor
 * de WebSockets que a su vez será el encargado de
 * gestionar las sesiones de juego con DosBox.
 */
module.exports = function(httpServer) {

  /**
   * Envía una respuesta
   */
  function response(type, message) {
    return { type, message }
  }

  /**
   * Envía un fallo
   */
  function failure(message) {
    return response('failure', message)
  }
  
  /**
   * Envía un ok!
   */
  function success(message) {
    return response('success', message)
  }

  /**
   * Detiene la sesión en curso.
   */
  function sessionStop(session) {
    clearInterval(session.interval)
    // session.audioTrack.stop()
    session.videoTrack.stop()
    session.peerConnection.close()
    session.controlledProcess.close()
    session.childProcess.kill()
  }

  log('Initializing robot mouse')
  const mouse = robot.Mouse()

  log('Initializing robot keyboard')
  const keyboard = robot.Keyboard()

  log('Initializing web socket server')
  const server = io(httpServer, {
    transports: ['websocket']
  })

  server.on('connection', (client) => {

    log('Client connected ' + client.id)

    client.on('stadium:close', (payload, callback) => {
      if (!sessions.has(client.id)) {
        // TODO: Aquí deberíamos fallar porque el usuario
        // está intentando cerrar una sesión y no está en
        // ninguna.
        return callback(failure('not-in-session'))
      }
      const session = sessions.get(client.id)
      sessionStop(session)
      sessions.delete(client.id)
    })

    //
    client.on('stadium:open', (payload, callback) => {
  
      if (sessions.has(client.id)) {
        // TODO: Aquí deberíamos lanzar un error porque el usuario
        // que intentó correr una aplicación ya está corriendo OTRA
        // aplicación.
        return callback(failure('already-in-session'))
      }

      // TODO: Aquí deberíamos acceder a la base de datos de juegos y obtener
      // la dirección del ejecutable que queremos ejecutar.
      const cwd = path.resolve(config.dosbox.games.path)
      log(config.dosbox.path, config.dosbox.games.path, cwd)
      const childProcess = cp.execFile(config.dosbox.path, ['.'], {
        cwd
      })

      log('Controlling process with robot-js')
      const controlledProcess = robot.Process(childProcess.pid)

      let windows, window
      do {
        windows = controlledProcess.getWindows()
        if (windows.length > 0) {
          const [mainWindow] = windows
          mainWindow.setTopMost(true)
          // Obtenemos la ventana de la aplicación.
          window = mainWindow
        }
      } while (windows.length === 0)

      log('Main window retrieved', window.getBounds())

      const peerConnection = new RTCPeerConnection({
        portRange: {
          min: 40000,
          max: 50000
        }
      })

      const session = {
        childProcess,
        controlledProcess,
        image: robot.Image(),
        frames: {
          rgba: null,
          i420: null
        },
        window,
        mouse,
        keyboard,
        videoSource: null,
        videoTrack: null,
        peerConnection,
        interval: null
      }
      
      childProcess.on('exit', (code) => {
        client.send('stadium:close')
        sessionStop(session)
        sessions.delete(client.id)
      })

      sessions.set(client.id, session)
      return callback(success('ok'))

    })

    client.on('rtc:offer', async (offer) => {
      if (!sessions.has(client.id)) {
        // TODO: Petar
      }

      log('rtc:offer', offer)

      const session = sessions.get(client.id)
      const peerConnection = session.peerConnection
      peerConnection.onnegotiationneeded = (e) => log(e)
      peerConnection.onicegatheringstatechange = (e) => log(e)
      peerConnection.oniceconnectionstatechange = (e) => log(e)
      peerConnection.onsignalingstatechange = (e) => log(e)

      // Enviamos los candidatos que obtenemos.
      peerConnection.onicecandidate = (e) => {
        log(e)
        if (e.candidate) {
          log('Sending ICE candidate')
          client.send('rtc:candidate', e.candidate)
        }
      }

      peerConnection.onicecandidateerror = (e) => {
        log(e)
        log('ICE candidate error', e)
      }

      // Obtenemos el canal de datos con el que recibiremos
      // los mensajes para controlar nuestro proceso.
      peerConnection.ondatachannel = (e) => {

        // TODO: Esto deberíamos sacarlo fuera para que no se convierta
        // esto aún más en un callback hell.
        log('Received data channel')
        e.channel.onopen = (e) => {
          log('datachannel open')
        } 

        e.channel.onmessage = (e) => {
          log('datachannel message', e.data)

          const [command, ...commandArgs] = e.data.split(' ')
          if (command === 'ku' || command === 'kd') {
            const [code, key] = commandArgs
            if (command === 'kd') {
              session.keyboard.press(keyCodes[code])
            } else if (command === 'ku') {
              session.keyboard.release(keyCodes[code])
            }
          }
        }

        e.channel.onclose = (e) => {
          log('datachannel close')
          // TODO: ¿Qué deberíamos hacer si esto ocurre?
          // Seguramente deberíamos cerrar la sesión.
        }

      }

      log('Offer received', offer)
      // Configuramos la remote description.
      await peerConnection.setRemoteDescription(offer)
      log('Offer set as remote description')
      
      // Creamos las fuentes que se usarán para obtener
      // datos de la aplicación. 
      log('Created RTCVideoSource')
      const videoSource = new RTCVideoSource()
      log('Created RTCMediaStreamTrack')
      const videoTrack = videoSource.createTrack()
      // const audioSource = new RTCAudioSource()
      // const audioTrack = audioSource.createTrack()
      peerConnection.addTrack(videoTrack)
      log('Adding track to peerConnection')
      
      // peerConnection.addTrack(audioTrack)
      session.videoSource = videoSource
      session.videoTrack = videoTrack

      log('Creating answer')
      const answer = await peerConnection.createAnswer()
      log('Applying answer as local description')
      await peerConnection.setLocalDescription(answer)

      let frameCount = 0

      const intervalMs = 1000 / config.framesPerSecond
      session.interval = setInterval(() => {
        if (robot.Screen.synchronize()) {
          const output = session.image

          robot.Screen.grabScreen(output, session.window.getBounds())

          const width = output.getWidth()
          const height = output.getHeight()
          const data = output.getData()
          if (!session.frames.rgba) {
            session.frames.rgba = {
              width,
              height,
              data: swapChannels(new Uint8ClampedArray(data.buffer))
            }
          } else {
            let isDirty = false
            if (session.frames.rgba.width !== width) {
              session.frames.rgba.width = width
              isDirty = true
            }

            if (session.frames.rgba.height !== height) {
              session.frames.rgba.height = height
              isDirty = true
            }

            if (isDirty) {
              log('Invalidating rgba frame data')
              session.frames.rgba.data = swapChannels(new Uint8ClampedArray(data.buffer))
            } else {
              session.frames.rgba.data.set(data.buffer, 0)
              swapChannels(session.frames.rgba.data)
            }
          }

          if (!session.frames.i420) {
            session.frames.i420 = {
              width,
              height,
              data: new Uint8ClampedArray(1.5 * width * height) 
            }
          } else {
            let isDirty = false
            if (session.frames.rgba.width !== width) {
              session.frames.rgba.width = width
              isDirty = true
            }

            if (session.frames.rgba.height !== height) {
              session.frames.rgba.height = height
              isDirty = true
            }

            if (isDirty) {
              log('Invalidating i420 frame data')
              session.frames.i420.data = new Uint8ClampedArray(1.5 * width * height) 
            }
          }

          // Convertimos la imagen de RGBA a I420
          rgbaToI420(session.frames.rgba, session.frames.i420)

          // Enviamos el fotograma convertido en I420
          session.videoSource.onFrame(session.frames.i420)
        }

      }, intervalMs)

      log('Sending answer')
      // Enviamos la respuesta.
      client.emit('rtc:answer', answer)

    })

    client.on('rtc:candidate', async (candidate) => {

      if (!sessions.has(client.id)) {
        // TODO: Deberíamos petar.
      }

      const session = sessions.get(client.id)
      const { peerConnection } = session
      if (candidate) {
        log('Adding ICE candidate')
        await peerConnection.addIceCandidate(candidate)
      }

    })

    client.on('disconnection', () => {
      
      log('Client disconnected' + client.id)

      // Si el usuario se desconecta, lo que hacemos es
      // cerrar el proceso que se está ejecutando. Lo suyo
      // sería que hubiera un timeout y que los procesos
      // se vinculasen al identificador del usuario y no
      // al identificador del socket.

      // Después cerramos el child Process.
      const session = sessions.get(client.id)
      sessionStop(session)
      sessions.delete(client.id)

    })

  })

  return server  
}
