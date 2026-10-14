const WebSocket = require('ws');
const assert = require('assert');
const http = require('http');

const PORT = process.env.PORT || '3000';
const SERVER_URL = process.env.SERVER_URL || `ws://localhost:${PORT}`;

function createClient(name, roomId, userId, role, cameraId = null) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const messages = [];

    ws.on('open', () => {
      // Send USER_JOINED matching signalingService format
      ws.send(JSON.stringify({
        type: 'USER_JOINED',
        roomId,
        senderId: userId,
        senderRole: role,
        timestamp: Date.now(),
        payload: {
          user: {
            id: userId,
            name,
            role,
            cameraId,
          },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        messages.push(parsed);
      } catch (err) {
        console.error(`${name} received invalid JSON:`, data.toString());
      }
    });

    ws.on('error', (err) => {
      console.error(`${name} socket error:`, err);
      reject(err);
    });

    // Wait 200ms to establish connection and complete initial sync
    setTimeout(() => {
      resolve({ name, roomId, userId, role, cameraId, ws, messages });
    }, 200);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runStressTest() {
  console.log('--- Starting Pass 3 Concurrency, Reconnection & Isolation Stress Test ---');

  // 1. Connect Director and 4 Cameras to STUDIO-A
  console.log('1. Connecting Director and 4 Cameras to STUDIO-A...');
  const directorA = await createClient('DirectorA', 'STUDIO-A', 'dir-1', 'director');
  const cam1A = await createClient('Cam1A', 'STUDIO-A', 'cam-1', 'camera', 'cam1');
  const cam2A = await createClient('Cam2A', 'STUDIO-A', 'cam-2', 'camera', 'cam2');
  const cam3A = await createClient('Cam3A', 'STUDIO-A', 'cam-3', 'camera', 'cam3');
  const cam4A = await createClient('Cam4A', 'STUDIO-A', 'cam-4', 'camera', 'cam4');

  await sleep(300);

  // 2. Connect another production room STUDIO-B to test isolation
  console.log('2. Connecting Director and Cam1 to STUDIO-B for isolation testing...');
  const directorB = await createClient('DirectorB', 'STUDIO-B', 'dir-b', 'director');
  const cam1B = await createClient('Cam1B', 'STUDIO-B', 'cam-1b', 'camera', 'cam1');

  await sleep(300);

  // 3. Rapid Tally Switches in STUDIO-A (50 switches)
  console.log('3. Executing 50 rapid tally switches from DirectorA...');
  const cams = ['cam1', 'cam2', 'cam3', 'cam4'];
  for (let i = 0; i < 50; i++) {
    const previewCam = cams[i % cams.length];
    const programCam = cams[(i + 1) % cams.length];
    directorA.ws.send(JSON.stringify({
      type: 'TALLY_UPDATE',
      roomId: 'STUDIO-A',
      senderId: 'dir-1',
      senderRole: 'director',
      timestamp: Date.now(),
      payload: {
        activePreviewCamera: previewCam,
        activeProgramCamera: programCam,
        senderRole: 'director',
      },
    }));
  }

  await sleep(400);

  // Verify STUDIO-A cameras received the tally updates
  const tallyMsgsOnCam1A = cam1A.messages.filter((m) => m.type === 'TALLY_UPDATE');
  console.log(`Cam1A received ${tallyMsgsOnCam1A.length} TALLY_UPDATE events (expected 50).`);
  assert.strictEqual(tallyMsgsOnCam1A.length, 50, 'Cam1A should receive all 50 tally updates');

  // Verify STUDIO-B received 0 tally updates from STUDIO-A (Room Isolation)
  const tallyMsgsOnCam1B = cam1B.messages.filter((m) => m.type === 'TALLY_UPDATE');
  console.log(`Cam1B received ${tallyMsgsOnCam1B.length} TALLY_UPDATE events from STUDIO-A (expected 0).`);
  assert.strictEqual(tallyMsgsOnCam1B.length, 0, 'STUDIO-B must have zero cross-talk from STUDIO-A');

  // 4. Role Authorization Security Test: Camera trying to issue TALLY_UPDATE
  console.log('4. Testing unauthorized TALLY_UPDATE from Cam1A...');
  const prevCount = cam2A.messages.filter((m) => m.type === 'TALLY_UPDATE').length;
  cam1A.ws.send(JSON.stringify({
    type: 'TALLY_UPDATE',
    roomId: 'STUDIO-A',
    senderId: 'cam-1',
    senderRole: 'camera',
    timestamp: Date.now(),
    payload: {
      activePreviewCamera: 'cam2',
      activeProgramCamera: 'cam1',
      senderRole: 'camera',
    },
  }));

  await sleep(200);
  const newCount = cam2A.messages.filter((m) => m.type === 'TALLY_UPDATE').length;
  console.log(`Cam2A tally update count before: ${prevCount}, after rogue update: ${newCount}`);
  assert.strictEqual(newCount, prevCount, 'Unauthorized tally update must be blocked by the server');

  // Verify Cam1A received an UNAUTHORIZED_TALLY_CHANGE error
  const errorsOnCam1A = cam1A.messages.filter((m) => m.type === 'ERROR');
  console.log(`Cam1A error count: ${errorsOnCam1A.length}`);
  assert.ok(errorsOnCam1A.some((e) => e.payload?.error === 'UNAUTHORIZED_TALLY_CHANGE'), 'Server must send UNAUTHORIZED_TALLY_CHANGE error');

  // 5. Remote Operator Mute Test (Director -> Cam3A)
  console.log('5. Testing Director remote-mute on Cam3A...');
  directorA.ws.send(JSON.stringify({
    type: 'MUTE_REMOTE_OPERATOR',
    roomId: 'STUDIO-A',
    senderId: 'dir-1',
    senderRole: 'director',
    timestamp: Date.now(),
    payload: {
      targetUserId: 'cam-3',
      mute: true,
      senderRole: 'director',
    },
  }));

  await sleep(200);
  const muteOnCam3 = cam3A.messages.filter((m) => m.type === 'MUTE_REMOTE_OPERATOR');
  console.log(`Cam3A received MUTE_REMOTE_OPERATOR: ${muteOnCam3.length} (expected >= 1)`);
  assert.ok(muteOnCam3.length >= 1, 'Cam3A must receive remote mute directive');
  assert.strictEqual(muteOnCam3[0].payload?.targetUserId, 'cam-3');

  // Unauthorized remote mute attempt by Cam1A targeting Cam2A
  console.log('Testing unauthorized remote mute by Cam1A...');
  const muteBefore = cam2A.messages.filter((m) => m.type === 'MUTE_REMOTE_OPERATOR').length;
  cam1A.ws.send(JSON.stringify({
    type: 'MUTE_REMOTE_OPERATOR',
    roomId: 'STUDIO-A',
    senderId: 'cam-1',
    senderRole: 'camera',
    timestamp: Date.now(),
    payload: {
      targetUserId: 'cam-2',
      mute: true,
      senderRole: 'camera',
    },
  }));
  await sleep(200);
  const muteAfter = cam2A.messages.filter((m) => m.type === 'MUTE_REMOTE_OPERATOR').length;
  assert.strictEqual(muteAfter, muteBefore, 'Unauthorized mute command must be blocked');

  // 6. Socket Reconnection Race & Handover Test
  console.log('6. Testing cellular/Wi-Fi handover reconnection race for Cam2A...');
  // Simulate Cam2 connecting with a new socket before the old socket closes
  const cam2A_reconnected = await createClient('Cam2A_New', 'STUDIO-A', 'cam-2', 'camera', 'cam2');

  // Now close the old socket (simulating delayed TCP FIN / network drop)
  console.log('Closing old Cam2A socket...');
  cam2A.ws.close();
  await sleep(300);

  // Verify that Cam2A_New is still in the room roster and receiving updates!
  console.log('Sending TALLY_UPDATE to verify reconnected Cam2A is still active...');
  directorA.ws.send(JSON.stringify({
    type: 'TALLY_UPDATE',
    roomId: 'STUDIO-A',
    senderId: 'dir-1',
    senderRole: 'director',
    timestamp: Date.now(),
    payload: {
      activePreviewCamera: 'cam1',
      activeProgramCamera: 'cam2',
      senderRole: 'director',
    },
  }));

  await sleep(300);
  const reconnectedTally = cam2A_reconnected.messages.filter((m) => m.type === 'TALLY_UPDATE');
  console.log(`Reconnected Cam2A received TALLY_UPDATE: ${reconnectedTally.length} (expected >= 1)`);
  assert.ok(reconnectedTally.length >= 1, 'Reconnected Cam2A must receive messages and NOT have been evicted');

  // 7. Cleanup and Health verification
  console.log('7. Cleaning up connections and verifying room release...');
  directorA.ws.close();
  cam1A.ws.close();
  cam2A_reconnected.ws.close();
  cam3A.ws.close();
  cam4A.ws.close();

  directorB.ws.close();
  cam1B.ws.close();

  await sleep(500);

  // Check health endpoint
  http.get(`http://localhost:${PORT}/health`, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => {
      const health = JSON.parse(body);
      console.log('Server Health post-test:', JSON.stringify(health, null, 2));
      assert.strictEqual(health.totalActiveRooms, 0, 'All rooms should be cleaned up and destroyed');
      assert.strictEqual(health.totalConnectedClients, 0, 'All clients should be disconnected');
      console.log('\n>>> ALL STRESS TEST SUITES PASSED PERFECTLY! <<<');
      process.exit(0);
    });
  });
}

runStressTest().catch((err) => {
  console.error('Stress test failed with error:', err);
  process.exit(1);
});
