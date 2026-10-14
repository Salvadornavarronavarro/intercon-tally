import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import {
  playPreviewTone,
  startProgramTone,
  stopAllTones,
  initAudioSession,
} from '../services/tallySoundService';
import {
  signalingService,
  ConnectionStatus,
  TallyUpdatePayload,
  MuteRemoteOperatorPayload,
  UserJoinedPayload,
  UserLeftPayload,
} from '../services/signalingService';
import { webrtcAudioService } from '../services/webrtcAudioService';

export type UserRole = 'director' | 'camera';
export type CameraId = string;
export type TallyState = 'idle' | 'preview' | 'program';

export interface Participant {
  id: string;
  name: string;
  role: UserRole;
  cameraId?: CameraId;
  isMuted: boolean;
}

export interface IntercomContextType {
  // State
  currentUser: Participant | null;
  currentRoomId: string | null;
  activePreviewCamera: string | null;
  activeProgramCamera: string | null;
  participantsList: Participant[];
  currentTallyState: TallyState;
  connectionStatus: ConnectionStatus;

  // Convenience computed helpers
  isMuted: boolean;
  isMutedByDirector: boolean;
  isDirector: boolean;
  isCamera: boolean;

  // Actions
  joinRoom: (roomId: string, user: Participant, signalingUrl?: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  setPreviewCamera: (cameraId: string | null) => void;
  setProgramCamera: (cameraId: string | null) => void;
  muteRemoteOperator: (targetUserId: string, targetCameraId?: string, mute?: boolean) => void;
  toggleMute: () => void;
  setParticipantsList: React.Dispatch<React.SetStateAction<Participant[]>>;

  // WebRTC Audio Calls
  startAudioCall: (roomId: string, userId: string) => Promise<boolean>;
  endAudioCall: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => void;
}

const IntercomContext = createContext<IntercomContextType | undefined>(undefined);

interface IntercomProviderProps {
  children: ReactNode;
}

export const IntercomProvider: React.FC<IntercomProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Participant | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [activePreviewCamera, setActivePreviewCamera] = useState<string | null>(null);
  const [activeProgramCamera, setActiveProgramCamera] = useState<string | null>(null);
  const [participantsList, setParticipantsList] = useState<Participant[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isMutedByDirector, setIsMutedByDirector] = useState<boolean>(false);

  const currentUserRef = useRef<Participant | null>(currentUser);
  currentUserRef.current = currentUser;

  const activeProgramCameraRef = useRef<string | null>(activeProgramCamera);
  activeProgramCameraRef.current = activeProgramCamera;

  const activePreviewCameraRef = useRef<string | null>(activePreviewCamera);
  activePreviewCameraRef.current = activePreviewCamera;

  // Calculate current device's tally status
  const currentTallyState: TallyState = useMemo(() => {
    if (!currentUser || currentUser.role !== 'camera' || !currentUser.cameraId) {
      return 'idle';
    }
    if (currentUser.cameraId === activeProgramCamera) {
      return 'program';
    }
    if (currentUser.cameraId === activePreviewCamera) {
      return 'preview';
    }
    return 'idle';
  }, [currentUser, activeProgramCamera, activePreviewCamera]);

  // Acoustic Tally Feedback Synchronization
  // Automatically triggers corresponding sound when the current camera's tally state changes
  useEffect(() => {
    // If not a camera, idle, or left room, ensure no tally tone is playing
    if (!currentUser || currentUser.role !== 'camera' || !currentUser.cameraId) {
      stopAllTones();
      return;
    }

    const cameraId = currentUser.cameraId;

    if (activeProgramCamera === cameraId) {
      // Camera is ON AIR / PROGRAM: start continuous tone loop
      console.log(`[IntercomContext] Camera ${cameraId} is ON AIR -> startProgramTone()`);
      startProgramTone();
    } else if (activePreviewCamera === cameraId) {
      // Camera is in STANDBY / PREVIEW: play single preview tone
      console.log(`[IntercomContext] Camera ${cameraId} is on PREVIEW -> playPreviewTone()`);
      playPreviewTone();
    } else {
      // Camera is IDLE / OFF-AIR: stop all tones
      stopAllTones();
    }
  }, [currentUser, activeProgramCamera, activePreviewCamera]);

  // Clean up any playing tones and connections when provider unmounts
  useEffect(() => {
    return () => {
      stopAllTones();
      signalingService.disconnect();
      webrtcAudioService.endAudioCall();
    };
  }, []);

  // Real-time signaling synchronization: bind listeners once
  useEffect(() => {
    const unsubStatus = signalingService.onConnectionChange((status) => {
      setConnectionStatus(status);
    });

    // Handle remote peer tally updates with STRICT DIRECTOR AUTHORIZATION
    const unsubTally = signalingService.on<TallyUpdatePayload>('TALLY_UPDATE', (payload, message) => {
      // Ignore echoing our own local broadcast
      const current = currentUserRef.current;
      if (current && message.senderId === current.id) return;

      // STRICT DIRECTOR AUTHORIZATION:
      // Verify that this tally update was emitted by an authorized Director
      const isAuthorizedDirector =
        message.senderRole === 'director' ||
        payload.senderRole === 'director';

      if (!isAuthorizedDirector) {
        console.warn(
          `[IntercomContext] REJECTED unauthorized TALLY_UPDATE from ${message.senderName || message.senderId} (${message.senderRole || 'unknown'})`
        );
        return;
      }

      console.log(
        `[IntercomContext] Authoritative TALLY_UPDATE received from Director (${message.senderName || message.senderId}): PGM=${payload.activeProgramCamera}, PVW=${payload.activePreviewCamera}`
      );

      if (payload.activeProgramCamera !== undefined) {
        setActiveProgramCamera(payload.activeProgramCamera);
      }
      if (payload.activePreviewCamera !== undefined) {
        setActivePreviewCamera(payload.activePreviewCamera);
      }
    });

    // Handle new peer arrival in the room
    const unsubJoined = signalingService.on<UserJoinedPayload>('USER_JOINED', (payload, message) => {
      if (!payload.user) return;
      const newUser = payload.user;

      setParticipantsList((prevList) => {
        const exists = prevList.some((p) => p.id === newUser.id);
        if (exists) {
          return prevList.map((p) => (p.id === newUser.id ? newUser : p));
        }
        return [...prevList, newUser];
      });

      // Reciprocal sync: Announce our presence back to newly joined tab
      const current = currentUserRef.current;
      if (!payload.isSyncReply && current && message.senderId !== current.id) {
        signalingService.send<UserJoinedPayload>('USER_JOINED', {
          user: current,
          isSyncReply: true,
        });

        // If this device is the Director, synchronize current tally state immediately
        if (current.role === 'director') {
          const pgm = activeProgramCameraRef.current;
          const pvw = activePreviewCameraRef.current;
          signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
            cameraId: pgm || pvw || '',
            state: pgm ? 'PROGRAM' : pvw ? 'PREVIEW' : 'IDLE',
            activeProgramCamera: pgm,
            activePreviewCamera: pvw,
            senderRole: 'director',
            directorId: current.id,
          });
        }
      }
    });

    // Handle peer departure
    const unsubLeft = signalingService.on<UserLeftPayload>('USER_LEFT', (payload) => {
      setParticipantsList((prevList) => prevList.filter((p) => p.id !== payload.userId));

      if (payload.cameraId) {
        setActiveProgramCamera((prev) => (prev === payload.cameraId ? null : prev));
        setActivePreviewCamera((prev) => (prev === payload.cameraId ? null : prev));
      }
    });

    // Handle remote mute command from Director
    const unsubMute = signalingService.on<MuteRemoteOperatorPayload>('MUTE_REMOTE_OPERATOR', (payload, message) => {
      const isAuthorizedDirector =
        message.senderRole === 'director' ||
        payload.senderRole === 'director';

      if (!isAuthorizedDirector) {
        console.warn(
          `[IntercomContext] REJECTED unauthorized MUTE_REMOTE_OPERATOR from ${message.senderName || message.senderId}`
        );
        return;
      }

      const targetId = payload.targetUserId;
      const targetCam = payload.targetCameraId;
      const shouldMute = payload.mute;

      console.log(
        `[IntercomContext] Authoritative MUTE_REMOTE_OPERATOR received from Director: target=${targetId || targetCam}, mute=${shouldMute}`
      );

      // Update in local roster
      setParticipantsList((prevList) =>
        prevList.map((p) => {
          if ((targetId && p.id === targetId) || (targetCam && p.cameraId === targetCam)) {
            return { ...p, isMuted: shouldMute };
          }
          return p;
        })
      );

      // If targeted to this device
      const current = currentUserRef.current;
      if (
        current &&
        ((targetId && current.id === targetId) ||
         (targetCam && current.cameraId === targetCam))
      ) {
        if (shouldMute) {
          setIsMutedByDirector(true);
          setCurrentUser((prev) => (prev ? { ...prev, isMuted: true } : null));
          webrtcAudioService.setMicEnabled(false);
        } else {
          setIsMutedByDirector(false);
        }
      }
    });

    return () => {
      unsubStatus();
      unsubTally();
      unsubJoined();
      unsubLeft();
      unsubMute();
    };
  }, []);

  /**
   * Starts WebRTC audio call manually
   */
  const startAudioCall = useCallback(async (rId: string, uId: string) => {
    return await webrtcAudioService.startAudioCall(rId, uId);
  }, []);

  /**
   * Ends WebRTC audio call and releases hardware
   */
  const endAudioCall = useCallback(async () => {
    await webrtcAudioService.endAudioCall();
  }, []);

  /**
   * Toggles microphone transmission state
   */
  const setMicEnabled = useCallback((enabled: boolean) => {
    webrtcAudioService.setMicEnabled(enabled);
  }, []);

  /**
   * Joins an intercom room with the given participant profile.
   * Initializes audio session for background playback, connects signaling, and starts mesh WebRTC voice call.
   */
  const joinRoom = useCallback(async (roomId: string, user: Participant, signalingUrl?: string) => {
    await initAudioSession();
    setCurrentRoomId(roomId);
    setCurrentUser(user);

    setParticipantsList((prevList) => {
      const exists = prevList.some((p) => p.id === user.id);
      if (exists) {
        return prevList.map((p) => (p.id === user.id ? user : p));
      }
      return [...prevList, user];
    });

    // 1. Connect to real-time pub/sub signaling server & BroadcastChannel
    await signalingService.connect(roomId, user, signalingUrl);

    // 2. Start full-duplex WebRTC mesh audio call
    await webrtcAudioService.startAudioCall(roomId, user.id);
    webrtcAudioService.setMicEnabled(!user.isMuted);
  }, []);

  /**
   * Leaves the current room, clears active tally assignments, broadcasts departure, and disconnects voice & signaling.
   */
  const leaveRoom = useCallback(async () => {
    const user = currentUserRef.current;
    if (user) {
      signalingService.send<UserLeftPayload>('USER_LEFT', {
        userId: user.id,
        cameraId: user.cameraId,
      });
    }

    signalingService.disconnect();
    await webrtcAudioService.endAudioCall();
    await stopAllTones();

    setCurrentUser(null);
    setCurrentRoomId(null);
    setActivePreviewCamera(null);
    setActiveProgramCamera(null);
    setParticipantsList([]);
    setConnectionStatus('disconnected');
    setIsMutedByDirector(false);
  }, []);

  /**
   * Sets the active preview camera (only one camera can be in preview at a time).
   * STRICT DIRECTOR AUTHORITY: Only Director role can set preview camera.
   * Immediately broadcasts TALLY_UPDATE event to all connected peers.
   */
  const setPreviewCamera = useCallback(
    (cameraId: string | null) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can set preview camera');
        return;
      }

      setActivePreviewCamera(cameraId);

      signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
        cameraId: cameraId || '',
        state: cameraId ? 'PREVIEW' : 'IDLE',
        activePreviewCamera: cameraId,
        activeProgramCamera: activeProgramCameraRef.current,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Sets the active program camera (only one camera can be on program/live at a time).
   * STRICT DIRECTOR AUTHORITY: Only Director role can cut to program.
   * Automatically cuts previous program camera, and clears preview if that camera was on preview.
   * Immediately broadcasts TALLY_UPDATE event to all connected peers.
   */
  const setProgramCamera = useCallback(
    (cameraId: string | null) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can set program camera');
        return;
      }

      const currentPreview = activePreviewCameraRef.current;
      const nextPreview = currentPreview === cameraId ? null : currentPreview;

      setActiveProgramCamera(cameraId);
      if (currentPreview === cameraId) {
        setActivePreviewCamera(null);
      }

      signalingService.send<TallyUpdatePayload>('TALLY_UPDATE', {
        cameraId: cameraId || '',
        state: cameraId ? 'PROGRAM' : 'IDLE',
        activeProgramCamera: cameraId,
        activePreviewCamera: nextPreview,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Remote Mute Control strictly reserved for the Director role.
   * Sends MUTE_REMOTE_OPERATOR to target participant / camera.
   */
  const muteRemoteOperator = useCallback(
    (targetUserId: string, targetCameraId?: string, mute = true) => {
      const user = currentUserRef.current;
      if (user?.role !== 'director') {
        console.warn('[IntercomContext] Unauthorized: Only director can mute remote operators');
        return;
      }

      // Update local presence roster immediately
      setParticipantsList((prevList) =>
        prevList.map((p) => {
          if (p.id === targetUserId || (targetCameraId && p.cameraId === targetCameraId)) {
            return { ...p, isMuted: mute };
          }
          return p;
        })
      );

      // Broadcast remote mute command across signaling
      signalingService.send<MuteRemoteOperatorPayload>('MUTE_REMOTE_OPERATOR', {
        targetUserId,
        targetCameraId,
        mute,
        senderRole: 'director',
        directorId: user.id,
      });
    },
    []
  );

  /**
   * Toggles the current participant's microphone mute status.
   * Immediately updates WebRTC hardware audio track transmission.
   */
  const toggleMute = useCallback(() => {
    setCurrentUser((prev) => {
      if (!prev) return null;
      const nextMuted = !prev.isMuted;
      const updatedUser: Participant = {
        ...prev,
        isMuted: nextMuted,
      };

      if (!nextMuted) {
        setIsMutedByDirector(false);
      }

      // Toggle outgoing WebRTC audio track
      webrtcAudioService.setMicEnabled(!nextMuted);

      setParticipantsList((list) =>
        list.map((p) => (p.id === prev.id ? updatedUser : p))
      );

      return updatedUser;
    });
  }, []);

  const value: IntercomContextType = useMemo(
    () => ({
      currentUser,
      currentRoomId,
      activePreviewCamera,
      activeProgramCamera,
      participantsList,
      currentTallyState,
      connectionStatus,
      isMuted: currentUser?.isMuted ?? false,
      isMutedByDirector,
      isDirector: currentUser?.role === 'director',
      isCamera: currentUser?.role === 'camera',
      joinRoom,
      leaveRoom,
      setPreviewCamera,
      setProgramCamera,
      muteRemoteOperator,
      toggleMute,
      setParticipantsList,
      startAudioCall,
      endAudioCall,
      setMicEnabled,
    }),
    [
      currentUser,
      currentRoomId,
      activePreviewCamera,
      activeProgramCamera,
      participantsList,
      currentTallyState,
      connectionStatus,
      isMutedByDirector,
      joinRoom,
      leaveRoom,
      setPreviewCamera,
      setProgramCamera,
      muteRemoteOperator,
      toggleMute,
      startAudioCall,
      endAudioCall,
      setMicEnabled,
    ]
  );

  return <IntercomContext.Provider value={value}>{children}</IntercomContext.Provider>;
};

/**
 * Custom hook to access the Intercom context.
 * Throws an error if used outside an IntercomProvider.
 */
export const useIntercom = (): IntercomContextType => {
  const context = useContext(IntercomContext);
  if (!context) {
    throw new Error('useIntercom must be used within an IntercomProvider');
  }
  return context;
};

export default IntercomContext;
