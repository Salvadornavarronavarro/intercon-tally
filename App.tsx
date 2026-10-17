import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  IntercomProvider,
  useIntercom,
  UserRole,
  CameraId,
  Participant,
} from './context/IntercomContext';
import { unlockAudioSession } from './services/tallySoundService';
import { webrtcAudioService } from './services/webrtcAudioService';
import { DirectorView } from './components/DirectorView';
import { CameraView } from './components/CameraView';

const AVAILABLE_CAMERAS: CameraId[] = [
  'cam1',
  'cam2',
  'cam3',
  'cam4',
  'cam5',
  'cam6',
  'cam7',
  'cam8',
];

const MainScreen: React.FC = () => {
  const { currentUser, joinRoom } = useIntercom();

  // Setup form states
  const [role, setRole] = useState<UserRole>('director');
  const [selectedCam, setSelectedCam] = useState<CameraId>('cam1');
  const [name, setName] = useState<string>('Director 1');
  const [roomId, setRoomId] = useState<string>('STUDIO-A');
  const [isJoining, setIsJoining] = useState<boolean>(false);

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === 'director') {
      setName('Director 1');
    } else {
      setName(`Cam ${selectedCam.replace('cam', '')} Operator`);
    }
  };

  const handleCameraChange = (cam: CameraId) => {
    setSelectedCam(cam);
    if (role === 'camera') {
      setName(`Cam ${cam.replace('cam', '')} Operator`);
    }
  };

  const handleJoin = async () => {
    if (!name.trim() || !roomId.trim()) return;

    // iPadOS / iOS & macOS WebKit Audio Unlocking directly on user touch/click
    try {
      await unlockAudioSession();
      await webrtcAudioService.unlockAudioPlayback();
    } catch (unlockErr) {
      console.warn('[App] Audio unlock warning:', unlockErr);
    }

    setIsJoining(true);
    try {
      const userProfile: Participant = {
        id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: name.trim(),
        role,
        cameraId: role === 'camera' ? selectedCam : undefined,
        isMuted: false, // Default to UNMUTED (active talkback) upon entering room
      };

      await joinRoom(roomId.trim().toUpperCase(), userProfile);
    } catch (err) {
      console.warn('Failed to join intercom room:', err);
    } finally {
      setIsJoining(false);
    }
  };

  // If user is already in a room, render the appropriate role view
  if (currentUser) {
    if (currentUser.role === 'director') {
      return <DirectorView />;
    }
    return <CameraView />;
  }

  // Otherwise, render Role Selection & Room Setup Screen
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D12" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header Title */}
          <View style={styles.brandingHeader}>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>BROADCAST READY</Text>
            </View>
            <Text style={styles.appTitle}>INTERCOM TALLY</Text>
            <Text style={styles.appSubtitle}>
              Live Production Audio & Acoustic Tally System
            </Text>
          </View>

          {/* Role Selection Tabs */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>SELECT OPERATOR ROLE</Text>
            <View style={styles.roleSelector}>
              <TouchableOpacity
                style={[styles.roleTab, role === 'director' && styles.roleTabActive]}
                onPress={() => handleRoleChange('director')}
                activeOpacity={0.8}
              >
                <Text style={styles.roleIcon}>🎬</Text>
                <Text
                  style={[
                    styles.roleTabText,
                    role === 'director' && styles.roleTabTextActive,
                  ]}
                >
                  DIRECTOR
                </Text>
                <Text style={styles.roleTabDesc}>Control Room & Tally Switcher</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleTab, role === 'camera' && styles.roleTabActive]}
                onPress={() => handleRoleChange('camera')}
                activeOpacity={0.8}
              >
                <Text style={styles.roleIcon}>🎥</Text>
                <Text
                  style={[
                    styles.roleTabText,
                    role === 'camera' && styles.roleTabTextActive,
                  ]}
                >
                  CAMERA
                </Text>
                <Text style={styles.roleTabDesc}>Tally Display & Talkback</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Camera Selection (Only visible if Camera Operator role is selected) */}
          {role === 'camera' && (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>ASSIGN CAMERA NUMBER</Text>
              <View style={styles.cameraPickerGrid}>
                {AVAILABLE_CAMERAS.map((cam) => {
                  const isSelected = selectedCam === cam;
                  const camNumber = cam.replace('cam', '');

                  return (
                    <TouchableOpacity
                      key={cam}
                      style={[
                        styles.cameraPickerTile,
                        isSelected && styles.cameraPickerTileSelected,
                      ]}
                      onPress={() => handleCameraChange(cam)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.cameraPickerNumber,
                          isSelected && styles.textWhite,
                        ]}
                      >
                        CAM {camNumber}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Room and Name Details */}
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>OPERATOR NAME</Text>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. John Doe"
                placeholderTextColor="#666678"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>PRODUCTION ROOM ID</Text>
              <TextInput
                style={styles.textInput}
                value={roomId}
                onChangeText={(val) => setRoomId(val.toUpperCase())}
                placeholder="e.g. STUDIO-A"
                placeholderTextColor="#666678"
                autoCapitalize="characters"
              />
            </View>
          </View>

          {/* Connect Action Button */}
          <TouchableOpacity
            style={[styles.connectButton, isJoining && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={isJoining}
            activeOpacity={0.85}
          >
            <Text style={styles.connectButtonText}>
              {isJoining ? 'CONNECTING...' : 'ENTER PRODUCTION INTERCOM'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Operates with background audio over Wi-Fi, 4G, and 5G cellular networks.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <IntercomProvider>
      <MainScreen />
    </IntercomProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D0D12',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  brandingHeader: {
    alignItems: 'center',
    marginVertical: 20,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E1E28',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 10,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF1744',
  },
  liveText: {
    color: '#D8D8E8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#8A8A9E',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#16161F',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262634',
  },
  fieldLabel: {
    color: '#8C8C9F',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  roleTab: {
    flex: 1,
    backgroundColor: '#0F0F14',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#22222E',
  },
  roleTabActive: {
    borderColor: '#00E676',
    backgroundColor: '#072414',
  },
  roleIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  roleTabText: {
    color: '#9E9EB0',
    fontWeight: '900',
    fontSize: 15,
  },
  roleTabTextActive: {
    color: '#FFFFFF',
  },
  roleTabDesc: {
    color: '#717184',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
  cameraPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cameraPickerTile: {
    width: '22.5%',
    backgroundColor: '#0F0F14',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#22222E',
  },
  cameraPickerTileSelected: {
    backgroundColor: '#00C853',
    borderColor: '#00E676',
  },
  cameraPickerNumber: {
    fontSize: 12,
    fontWeight: '900',
    color: '#A0A0B5',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  inputGroup: {
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#0F0F14',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#242432',
  },
  connectButton: {
    backgroundColor: '#FF1744',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  footnote: {
    textAlign: 'center',
    color: '#555566',
    fontSize: 11,
    marginTop: 16,
  },
});
