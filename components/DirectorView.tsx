import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useIntercom, Participant } from '../context/IntercomContext';
import {
  voiceCommandService,
  ParsedVoiceCommand,
  parseVoiceCommand,
} from '../services/voiceCommandService';

const CAMERAS = ['cam1', 'cam2', 'cam3', 'cam4', 'cam5', 'cam6', 'cam7', 'cam8'];

const CAMERA_LABELS: Record<string, string> = {
  cam1: 'CAM 1',
  cam2: 'CAM 2',
  cam3: 'CAM 3',
  cam4: 'CAM 4',
  cam5: 'CAM 5',
  cam6: 'CAM 6',
  cam7: 'CAM 7',
  cam8: 'CAM 8',
};

export const DirectorView: React.FC = () => {
  const {
    currentUser,
    currentRoomId,
    activePreviewCamera,
    activeProgramCamera,
    participantsList,
    connectionStatus,
    isMuted,
    setPreviewCamera,
    setProgramCamera,
    muteRemoteOperator,
    toggleMute,
    leaveRoom,
  } = useIntercom();

  // Voice command state (Director only)
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<ParsedVoiceCommand | null>(null);
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const isVoiceSupported = voiceCommandService.isSupported();

  useEffect(() => {
    return () => {
      voiceCommandService.stopListening();
    };
  }, []);

  const handleToggleVoice = async () => {
    if (isVoiceActive) {
      await voiceCommandService.stopListening();
      setIsVoiceActive(false);
      setInterimSpeech('');
    } else {
      setVoiceError(null);
      const success = await voiceCommandService.startListening(currentUser?.role, {
        onCommand: (command) => {
          if (command.type === 'PREVIEW') {
            setPreviewCamera(command.cameraId);
          } else if (command.type === 'PROGRAM') {
            setProgramCamera(command.cameraId);
          }
          setLastCommand(command);
          setInterimSpeech('');
        },
        onTranscript: (transcript) => {
          setInterimSpeech(transcript);
        },
        onStatusChange: (listening, error) => {
          setIsVoiceActive(listening);
          if (error) {
            setVoiceError(error);
          }
        },
        onError: (err) => {
          setVoiceError(err);
        },
      });

      if (!success) {
        setIsVoiceActive(false);
      }
    }
  };

  const handleTestVoiceCommand = (phrase: string) => {
    const cmd = parseVoiceCommand(phrase);
    if (cmd) {
      if (cmd.type === 'PREVIEW') {
        setPreviewCamera(cmd.cameraId);
      } else if (cmd.type === 'PROGRAM') {
        setProgramCamera(cmd.cameraId);
      }
      setLastCommand(cmd);
      setInterimSpeech('');
    }
  };

  // Find camera operator assigned to a specific camera ID
  const getOperatorForCamera = (camId: string): Participant | undefined => {
    return participantsList.find((p) => p.role === 'camera' && p.cameraId === camId);
  };

  /**
   * Camera tile tap interaction:
   * - If idle -> Set to PREVIEW (Green)
   * - If preview -> Promote to PROGRAM (Red) and cut previous program
   * - If program -> Keep program (or tap preview to stage next)
   */
  const handleCameraTilePress = (camId: string) => {
    if (activeProgramCamera === camId) {
      // Already live on Program
      return;
    }

    if (activePreviewCamera === camId) {
      // In Preview: Cut to Program
      setProgramCamera(camId);
    } else {
      // Idle or other: Stage into Preview
      setPreviewCamera(camId);
    }
  };

  /**
   * Dedicated CUT / TAKE action
   * Transitions whatever is in Preview directly into Program
   */
  const handleTakeCut = () => {
    if (activePreviewCamera) {
      setProgramCamera(activePreviewCamera);
    }
  };

  const handleClearTally = () => {
    setProgramCamera(null);
    setPreviewCamera(null);
  };

  const getConnectionBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return { label: 'ONLINE', color: '#00E676', dot: '#00E676' };
      case 'reconnecting':
        return { label: 'RECONNECTING', color: '#FFD600', dot: '#FFD600' };
      case 'connecting':
        return { label: 'CONNECTING', color: '#29B6F6', dot: '#29B6F6' };
      default:
        return { label: 'OFFLINE', color: '#9E9E9E', dot: '#757575' };
    }
  };

  const badge = getConnectionBadge();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" />

      {/* Top Director Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.roleTag}>
            <Text style={styles.roleTagText}>DIRECTOR</Text>
          </View>
          <Text style={styles.roomText}>ROOM: {currentRoomId || 'DEFAULT'}</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.headerMicBtn, isMuted ? styles.headerMicMuted : styles.headerMicActive]}
            onPress={toggleMute}
            activeOpacity={0.8}
          >
            <Text style={styles.headerMicIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
            <Text style={[styles.headerMicText, isMuted ? styles.headerMicTextMuted : styles.headerMicTextActive]}>
              {isMuted ? 'MUTED' : 'MIC ON'}
            </Text>
          </TouchableOpacity>

          <View style={[styles.statusPill, { borderColor: badge.color }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.dot }]} />
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
          </View>

          <TouchableOpacity style={styles.leaveButton} onPress={leaveRoom}>
            <Text style={styles.leaveButtonText}>EXIT</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Switcher Control Bar (Preview / Program / Take) */}
        <View style={styles.switcherBar}>
          <View style={styles.switcherStatusGroup}>
            <View style={styles.switcherStatusBox}>
              <Text style={styles.switcherStatusLabel}>PROGRAM (LIVE)</Text>
              <Text style={[styles.switcherStatusValue, styles.programText]}>
                {activeProgramCamera ? CAMERA_LABELS[activeProgramCamera] || activeProgramCamera : 'NONE'}
              </Text>
            </View>

            <View style={styles.switcherStatusBox}>
              <Text style={styles.switcherStatusLabel}>PREVIEW (STANDBY)</Text>
              <Text style={[styles.switcherStatusValue, styles.previewText]}>
                {activePreviewCamera ? CAMERA_LABELS[activePreviewCamera] || activePreviewCamera : 'NONE'}
              </Text>
            </View>
          </View>

          <View style={styles.switcherActions}>
            <TouchableOpacity
              style={[
                styles.cutButton,
                !activePreviewCamera && styles.buttonDisabled,
              ]}
              disabled={!activePreviewCamera}
              onPress={handleTakeCut}
            >
              <Text style={styles.cutButtonText}>TAKE / CUT</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.clearButton} onPress={handleClearTally}>
              <Text style={styles.clearButtonText}>CLEAR</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hands-Free Voice Command Recognition Panel (Director ONLY) */}
        <View style={styles.voicePanel}>
          <View style={styles.voiceHeader}>
            <View style={styles.voiceTitleGroup}>
              <View style={[styles.voiceMicIconContainer, isVoiceActive && styles.voiceMicIconActive]}>
                <Text style={styles.voiceMicIcon}>🎙️</Text>
              </View>
              <View>
                <View style={styles.voiceBadgeRow}>
                  <Text style={styles.voiceTitle}>VOICE TALLY SWITCHER</Text>
                  <View style={[styles.langBadge, isVoiceActive && styles.langBadgeActive]}>
                    <Text style={styles.langBadgeText}>ES-ES</Text>
                  </View>
                </View>
                <Text style={styles.voiceSubtitle}>
                  Comandos de voz en español • Manos libres • Director
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.voiceToggleBtn,
                isVoiceActive ? styles.voiceToggleBtnActive : styles.voiceToggleBtnInactive,
              ]}
              onPress={handleToggleVoice}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.voicePulsingDot,
                  isVoiceActive ? styles.voiceDotActive : styles.voiceDotInactive,
                ]}
              />
              <Text style={styles.voiceToggleBtnText}>
                {isVoiceActive ? 'LISTENING (TAP TO STOP)' : 'START LISTENING'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Voice Status & Last Recognized Command */}
          <View style={styles.voiceStatusBody}>
            <View style={styles.voiceStatusRow}>
              <Text style={styles.voiceStatusLabel}>ESTADO DEL MICRO:</Text>
              <View style={styles.voiceStatusValueRow}>
                <View
                  style={[
                    styles.voiceStatusDot,
                    isVoiceActive ? styles.dotGreen : styles.dotGray,
                  ]}
                />
                <Text
                  style={[
                    styles.voiceStatusValue,
                    isVoiceActive ? styles.textGreen : styles.textGray,
                  ]}
                >
                  {isVoiceActive
                    ? 'ESCUCHANDO CONTINUAMENTE'
                    : isVoiceSupported
                    ? 'INACTIVO / STANDBY'
                    : 'NAVEGADOR NO COMPATIBLE (USAR CHROME/SAFARI)'}
                </Text>
              </View>
            </View>

            {/* Last Recognized Command Banner */}
            {lastCommand ? (
              <View style={styles.lastCommandRow}>
                <Text style={styles.lastCommandLabel}>ÚLTIMO COMANDO:</Text>
                <View
                  style={[
                    styles.commandBadge,
                    lastCommand.type === 'PROGRAM'
                      ? styles.commandBadgeProgram
                      : styles.commandBadgePreview,
                  ]}
                >
                  <Text style={styles.commandBadgeText}>
                    Recognized: "{lastCommand.rawPhrase}" →{' '}
                    {lastCommand.type === 'PROGRAM' ? 'LIVE / ON AIR' : 'PREVIEW / STANDBY'}{' '}
                    ({CAMERA_LABELS[lastCommand.cameraId] || lastCommand.cameraId.toUpperCase()})
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.lastCommandRow}>
                <Text style={styles.lastCommandLabel}>ÚLTIMO COMANDO:</Text>
                <Text style={styles.noCommandText}>Esperando comando de voz...</Text>
              </View>
            )}

            {/* Real-time interim feedback */}
            {isVoiceActive && interimSpeech ? (
              <View style={styles.interimRow}>
                <Text style={styles.interimLabel}>OYENDO:</Text>
                <Text style={styles.interimText}>"{interimSpeech}..."</Text>
              </View>
            ) : null}

            {/* Error banner if any */}
            {voiceError ? (
              <View style={styles.voiceErrorBox}>
                <Text style={styles.voiceErrorText}>⚠️ {voiceError}</Text>
              </View>
            ) : null}

            {/* Quick Testing Voice Triggers */}
            <View style={styles.triggersHintContainer}>
              <Text style={styles.triggersHintTitle}>COMANDOS DE VOZ Y PRUEBA RÁPIDA:</Text>
              <View style={styles.testButtonsRow}>
                <TouchableOpacity
                  style={[styles.testChip, styles.testChipPreview]}
                  onPress={() => handleTestVoiceCommand('preparada cámara 1')}
                >
                  <Text style={styles.testChipText}>"Preparada Cam 1"</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testChip, styles.testChipPreview]}
                  onPress={() => handleTestVoiceCommand('previo 2')}
                >
                  <Text style={styles.testChipText}>"Previo 2"</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testChip, styles.testChipProgram]}
                  onPress={() => handleTestVoiceCommand('dentro cámara 1')}
                >
                  <Text style={styles.testChipText}>"Dentro Cam 1"</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testChip, styles.testChipProgram]}
                  onPress={() => handleTestVoiceCommand('cámara 2 dentro')}
                >
                  <Text style={styles.testChipText}>"Cam 2 dentro"</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testChip, styles.testChipProgram]}
                  onPress={() => handleTestVoiceCommand('corte 3')}
                >
                  <Text style={styles.testChipText}>"Corte 3"</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* 8-Camera Grid */}
        <Text style={styles.sectionTitle}>CAMERA TALLY MATRIX (TAP TO STAGE / CUT)</Text>
        <View style={styles.cameraGrid}>
          {CAMERAS.map((camId) => {
            const isProgram = activeProgramCamera === camId;
            const isPreview = activePreviewCamera === camId;
            const operator = getOperatorForCamera(camId);

            let tileStyle = styles.tileIdle;
            let statusBadgeStyle = styles.badgeIdle;
            let statusText = 'IDLE';

            if (isProgram) {
              tileStyle = styles.tileProgram;
              statusBadgeStyle = styles.badgeProgram;
              statusText = 'ON AIR';
            } else if (isPreview) {
              tileStyle = styles.tilePreview;
              statusBadgeStyle = styles.badgePreview;
              statusText = 'PREVIEW';
            }

            return (
              <TouchableOpacity
                key={camId}
                style={[styles.cameraTile, tileStyle]}
                onPress={() => handleCameraTilePress(camId)}
                activeOpacity={0.8}
              >
                <View style={styles.tileHeader}>
                  <Text style={[styles.cameraNumber, isProgram && styles.textWhite]}>
                    {CAMERA_LABELS[camId]}
                  </Text>
                  <View style={[styles.tileBadge, statusBadgeStyle]}>
                    <Text style={styles.tileBadgeText}>{statusText}</Text>
                  </View>
                </View>

                {/* Operator status row with Director Remote Mute toggle */}
                <View style={styles.tileFooter}>
                  {operator ? (
                    <View style={styles.operatorRow}>
                      <View style={styles.onlineIndicator} />
                      <Text style={styles.operatorName} numberOfLines={1}>
                        {operator.name}
                      </Text>
                      {/* Individual remote microphone toggle for Director */}
                      <TouchableOpacity
                        style={[
                          styles.tileMicBtn,
                          operator.isMuted ? styles.tileMicBtnMuted : styles.tileMicBtnLive,
                        ]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          muteRemoteOperator(operator.id, camId, !operator.isMuted);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        activeOpacity={0.7}
                        accessibilityLabel={`Toggle mic for ${operator.name}`}
                      >
                        <Text style={styles.tileMicIcon}>
                          {operator.isMuted ? '🔇' : '🎙️'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.noOperatorText}>NO OPERATOR</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Connected Participants Section */}
        <View style={styles.participantsSection}>
          <Text style={styles.sectionTitle}>
            CONNECTED INTERCOM OPERATORS ({participantsList.length})
          </Text>

          {participantsList.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No operators connected yet</Text>
            </View>
          ) : (
            <View style={styles.participantsList}>
              {participantsList.map((p) => {
                const isLocal = currentUser?.id === p.id;
                const isOperator = p.role === 'camera';
                return (
                  <View key={p.id} style={styles.participantItem}>
                    <View style={styles.participantInfo}>
                      <View style={styles.participantRolePill}>
                        <Text style={styles.participantRoleText}>
                          {p.role === 'director' ? 'DIR' : CAMERA_LABELS[p.cameraId || ''] || 'CAM'}
                        </Text>
                      </View>
                      <Text style={styles.participantName}>
                        {p.name} {isLocal && '(YOU)'}
                      </Text>
                    </View>

                    <View style={styles.participantStatus}>
                      {isOperator ? (
                        <TouchableOpacity
                          style={[
                            styles.participantMicBtn,
                            p.isMuted ? styles.participantMicBtnMuted : styles.participantMicBtnLive,
                          ]}
                          onPress={() => muteRemoteOperator(p.id, p.cameraId, !p.isMuted)}
                          activeOpacity={0.7}
                          accessibilityLabel={`Toggle remote mic for ${p.name}`}
                        >
                          <Text style={styles.participantMicIcon}>
                            {p.isMuted ? '🔇' : '🎙️'}
                          </Text>
                          <Text
                            style={[
                              styles.participantMicText,
                              p.isMuted ? styles.textMutedRed : styles.textLiveGreen,
                            ]}
                          >
                            {p.isMuted ? 'MUTED' : 'LIVE MIC'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.directorStatusBadge}>
                          <Text style={styles.directorStatusIcon}>
                            {p.isMuted ? '🔇' : '🎙️'}
                          </Text>
                          <Text style={[styles.micStatusText, p.isMuted && styles.textMuted]}>
                            {p.isMuted ? 'MUTED' : 'LIVE MIC'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom Director Talkback Controls */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.talkButton, isMuted ? styles.talkButtonMuted : styles.talkButtonLive]}
          onPress={toggleMute}
          activeOpacity={0.85}
        >
          <Text style={styles.talkButtonIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
          <View>
            <Text style={styles.talkButtonLabel}>DIRECTOR MIC</Text>
            <Text style={styles.talkButtonState}>
              {isMuted ? 'MUTED (TAP TO TALK)' : 'LIVE TO CREW (TAP TO MUTE)'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F28',
    backgroundColor: '#111116',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleTag: {
    backgroundColor: '#3700B3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  roleTagText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  roomText: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  leaveButton: {
    backgroundColor: '#272730',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  leaveButtonText: {
    color: '#FF5252',
    fontWeight: '700',
    fontSize: 12,
  },
  headerMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  headerMicActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: '#00E676',
  },
  headerMicMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
    borderColor: '#FF1744',
  },
  headerMicIcon: {
    fontSize: 12,
  },
  headerMicText: {
    fontSize: 10,
    fontWeight: '800',
  },
  headerMicTextActive: {
    color: '#00E676',
  },
  headerMicTextMuted: {
    color: '#FF1744',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },
  switcherBar: {
    backgroundColor: '#16161E',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#262633',
  },
  switcherStatusGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  switcherStatusBox: {
    flex: 1,
    backgroundColor: '#0D0D12',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#22222E',
  },
  switcherStatusLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  switcherStatusValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  programText: {
    color: '#FF1744',
  },
  previewText: {
    color: '#00E676',
  },
  switcherActions: {
    flexDirection: 'row',
    gap: 10,
  },
  cutButton: {
    flex: 3,
    backgroundColor: '#D50000',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cutButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
  clearButton: {
    flex: 1,
    backgroundColor: '#2A2A38',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    color: '#B0B0C0',
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  sectionTitle: {
    color: '#7D7D92',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  cameraGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  cameraTile: {
    width: '48.5%',
    minHeight: 96,
    borderRadius: 10,
    padding: 12,
    justifyContent: 'space-between',
    borderWidth: 2,
  },
  tileIdle: {
    backgroundColor: '#16161D',
    borderColor: '#242430',
  },
  tilePreview: {
    backgroundColor: '#0A291A',
    borderColor: '#00E676',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  tileProgram: {
    backgroundColor: '#3E0A12',
    borderColor: '#FF1744',
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },
  tileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraNumber: {
    fontSize: 19,
    fontWeight: '900',
    color: '#E6E6F0',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  tileBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeIdle: {
    backgroundColor: '#262634',
  },
  badgePreview: {
    backgroundColor: '#00E676',
  },
  badgeProgram: {
    backgroundColor: '#FF1744',
  },
  tileBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  tileFooter: {
    marginTop: 8,
  },
  operatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onlineIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E676',
  },
  operatorName: {
    color: '#CFD2DC',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  mutedIcon: {
    fontSize: 11,
  },
  tileMicBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileMicBtnLive: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderColor: '#00E676',
  },
  tileMicBtnMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.2)',
    borderColor: '#FF1744',
  },
  tileMicIcon: {
    fontSize: 12,
  },
  noOperatorText: {
    color: '#555566',
    fontSize: 11,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  participantsSection: {
    marginTop: 4,
  },
  participantsList: {
    backgroundColor: '#16161E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262633',
    overflow: 'hidden',
  },
  participantItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22222E',
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  participantRolePill: {
    backgroundColor: '#282838',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  participantRoleText: {
    color: '#00E5FF',
    fontWeight: '800',
    fontSize: 10,
  },
  participantName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  participantStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  micStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00E676',
  },
  textMuted: {
    color: '#8A8A9E',
  },
  participantMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  participantMicBtnLive: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: '#00E676',
  },
  participantMicBtnMuted: {
    backgroundColor: 'rgba(255, 23, 68, 0.18)',
    borderColor: '#FF1744',
  },
  participantMicIcon: {
    fontSize: 12,
  },
  participantMicText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textLiveGreen: {
    color: '#00E676',
  },
  textMutedRed: {
    color: '#FF5252',
  },
  directorStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  directorStatusIcon: {
    fontSize: 12,
  },
  emptyCard: {
    backgroundColor: '#16161E',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262633',
  },
  emptyText: {
    color: '#656578',
    fontSize: 13,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    backgroundColor: '#111116',
    borderTopWidth: 1,
    borderTopColor: '#1F1F28',
  },
  talkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 12,
  },
  talkButtonMuted: {
    backgroundColor: '#22222C',
    borderWidth: 1,
    borderColor: '#373748',
  },
  talkButtonLive: {
    backgroundColor: '#00C853',
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  talkButtonIcon: {
    fontSize: 24,
  },
  talkButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  talkButtonState: {
    color: '#E0E0E0',
    fontSize: 11,
    fontWeight: '600',
  },
  voicePanel: {
    backgroundColor: '#121218',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#242432',
    marginBottom: 16,
    overflow: 'hidden',
  },
  voiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#171720',
    borderBottomWidth: 1,
    borderBottomColor: '#242432',
    gap: 8,
  },
  voiceTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  voiceMicIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#20202C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#323246',
  },
  voiceMicIconActive: {
    backgroundColor: '#003314',
    borderColor: '#00E676',
  },
  voiceMicIcon: {
    fontSize: 18,
  },
  voiceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  langBadge: {
    backgroundColor: '#282838',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  langBadgeActive: {
    backgroundColor: '#004D20',
  },
  langBadgeText: {
    color: '#00E676',
    fontSize: 9,
    fontWeight: '800',
  },
  voiceSubtitle: {
    color: '#8A8A9E',
    fontSize: 11,
    marginTop: 2,
  },
  voiceToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    gap: 6,
  },
  voiceToggleBtnInactive: {
    backgroundColor: '#272736',
    borderWidth: 1,
    borderColor: '#3D3D52',
  },
  voiceToggleBtnActive: {
    backgroundColor: '#B71C1C',
    borderWidth: 1,
    borderColor: '#FF1744',
  },
  voiceToggleBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  voicePulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  voiceDotActive: {
    backgroundColor: '#FFFFFF',
  },
  voiceDotInactive: {
    backgroundColor: '#7A7A90',
  },
  voiceStatusBody: {
    padding: 12,
    gap: 8,
  },
  voiceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceStatusLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  voiceStatusValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotGreen: {
    backgroundColor: '#00E676',
  },
  dotGray: {
    backgroundColor: '#616170',
  },
  voiceStatusValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  textGreen: {
    color: '#00E676',
  },
  textGray: {
    color: '#8A8A9E',
  },
  lastCommandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  lastCommandLabel: {
    color: '#8A8A9E',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  noCommandText: {
    color: '#555566',
    fontSize: 11,
    fontStyle: 'italic',
  },
  commandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  commandBadgeProgram: {
    backgroundColor: '#D50000',
  },
  commandBadgePreview: {
    backgroundColor: '#00C853',
  },
  commandBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  interimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  interimLabel: {
    color: '#FFB300',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    width: 105,
  },
  interimText: {
    color: '#FFE082',
    fontSize: 11,
    fontStyle: 'italic',
  },
  voiceErrorBox: {
    backgroundColor: '#2A1215',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#5C1D24',
  },
  voiceErrorText: {
    color: '#FF8A80',
    fontSize: 11,
  },
  triggersHintContainer: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E1E2A',
    gap: 6,
  },
  triggersHintTitle: {
    color: '#6F6F84',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  testButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  testChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  testChipPreview: {
    backgroundColor: '#0D2916',
    borderColor: '#1B5E20',
  },
  testChipProgram: {
    backgroundColor: '#301316',
    borderColor: '#7F1D1D',
  },
  testChipText: {
    color: '#E0E0E0',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default DirectorView;
