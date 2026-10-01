import AgoraRTC, { IAgoraRTCClient, ILocalAudioTrack } from 'agora-rtc-sdk-ng';
import { auth } from '@/config/firebase';

export type CallApiResponse = { success: boolean; callId?: string; channel?: string; appId?: string; token?: string; uid?: string | number; expiresAt?: number; error?: string };

const API_BASE = 'https://aletwend-render-backend.onrender.com';

export async function callApi(path: string, body: Record<string, unknown>): Promise<CallApiResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to make a call');
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || 'Call request failed');
  return result;
}

export async function joinChannel({ appId, token, channel, uid }: { appId: string; token?: string | null; channel: string; uid: string | number }, onRemoteAudio?: () => void) {
  const client: IAgoraRTCClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  let mic: ILocalAudioTrack | null = null;
  try {
    await client.join(appId, channel, token || null, uid);
    client.on('user-published', async (user, mediaType) => { await client.subscribe(user, mediaType); if (mediaType === 'audio' && user.audioTrack) { user.audioTrack.play(); onRemoteAudio?.(); } });
    mic = await AgoraRTC.createMicrophoneAudioTrack();
    await client.publish([mic]);
  } catch (error) { mic?.close(); await client.leave().catch(() => undefined); throw error; }
  return { leave: async () => { mic?.close(); await client.leave(); }, setMuted: async (muted: boolean) => { await mic?.setEnabled(!muted); } };
}
