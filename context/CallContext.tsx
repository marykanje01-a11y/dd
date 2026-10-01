import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { onValue, ref, off } from 'firebase/database';
import { auth, database } from '@/config/firebase';
import { joinChannel, callApi } from '@/services/callService';
const callApiRequest: any = callApi;
const joinCallChannel: any = joinChannel;
import callSound from '@/assets/sounds/call.mp3';
import { useAudioPlayer } from 'expo-audio';

type State = 'idle' | 'calling' | 'ringing' | 'in-call' | 'ended';
type CallData = any;
type CallContextValue = { callState: State; peerName: string; elapsedSeconds: number; formattedTime: string; isMuted: boolean; endedMessage: string; startCall: (orderId: string) => Promise<void>; answerCall: () => Promise<void>; declineCall: () => Promise<void>; endCall: () => Promise<void>; toggleMute: () => Promise<void> };
const Context = createContext<CallContextValue | null>(null);
const terminal = new Set(['ended', 'declined', 'missed']);
const format = (s: number) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0'); const sec = (s % 60).toString().padStart(2, '0'); return h ? `${h}:${m}:${sec}` : `${m}:${sec}`; };

export function CallProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(callSound); const [state, setState] = useState<State>('idle'); const [call, setCall] = useState<CallData>(null); const [elapsed, setElapsed] = useState(0); const [muted, setMuted] = useState(false); const [message, setMessage] = useState(''); const seenRef = useRef(false); const sessionCallRef = useRef<string | null>(null); const connectionRef = useRef<any>(null); const offsetRef = useRef(0);
  const audio = player as any;
  const ringRequestRef = useRef(0);
  const pendingPlayRef = useRef<Promise<unknown> | null>(null);
  const stopRing = () => {
    const requestId = ++ringRequestRef.current;
    const stopPlayback = () => {
      if (requestId !== ringRequestRef.current) return;
      try {
        audio.pause();
        audio.seekTo(0);
      } catch {}
    };

    // Do not pause an HTML audio element while play() is still pending. Browsers
    // reject that pending promise with AbortError and report it as a runtime error.
    if (pendingPlayRef.current) {
      pendingPlayRef.current.then(stopPlayback, stopPlayback);
    } else {
      stopPlayback();
    }
  };
  const ring = () => {
    const requestId = ++ringRequestRef.current;
    try {
      audio.loop = true;
      const playRequest = audio.play();
      if (playRequest && typeof playRequest.then === 'function') {
        const pendingPlay = Promise.resolve(playRequest);
        pendingPlayRef.current = pendingPlay;
        pendingPlay.then(
          () => {
            if (pendingPlayRef.current === pendingPlay) pendingPlayRef.current = null;
            if (requestId !== ringRequestRef.current) stopRing();
          },
          (error: unknown) => {
            if (pendingPlayRef.current === pendingPlay) pendingPlayRef.current = null;
            // AbortError is expected when playback is interrupted by navigation or cleanup.
            if (error instanceof Error && error.name !== 'AbortError') return;
          },
        );
      }
    } catch {}
  };
  useEffect(() => () => stopRing(), [player]);
  useEffect(() => { const uid = auth.currentUser?.uid; if (!uid) return; const callRef = ref(database, `user_calls/${uid}`); const offsetRefDb = ref(database, '.info/serverTimeOffset'); const offTime = onValue(offsetRefDb, s => { offsetRef.current = s.val() || 0; }); const offCall = onValue(callRef, snapshot => { const data = snapshot.val() as CallData; if (!data) return; const now = Date.now() + offsetRef.current; if (!sessionCallRef.current && (terminal.has(data.status) || (data.expiresAt && data.expiresAt <= now))) return; if (data.status === 'ringing' && data.direction === 'incoming' && !['in-call','calling'].includes(state)) { sessionCallRef.current = data.callId; seenRef.current = true; setCall(data); setState('ringing'); ring(); } else if (data.status === 'active' && sessionCallRef.current === data.callId) { stopRing(); setCall(data); setState('in-call'); } else if (terminal.has(data.status) && sessionCallRef.current === data.callId && seenRef.current) { stopRing(); setMessage(data.status === 'declined' ? 'Call declined' : data.status === 'missed' ? 'No answer' : 'Call ended'); setState('ended'); setTimeout(() => { setState('idle'); setMessage(''); sessionCallRef.current = null; }, 2500); } }); return () => { off(callRef, 'value', offCall); off(offsetRefDb, 'value', offTime); }; }, [state]);
  useEffect(() => { if (state !== 'in-call' || !call?.startedAt) return; const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() + offsetRef.current - call.startedAt) / 1000))); tick(); const id = setInterval(tick, 1000); return () => clearInterval(id); }, [state, call?.startedAt]);
  const startCall = async (orderId: string) => { if (state !== 'idle') return; try { setState('calling'); const result = await callApiRequest('/api/calls/start', { orderId }); sessionCallRef.current = result.callId || null; seenRef.current = true; setCall({ ...result, peerName: 'Rider' }); connectionRef.current = await joinCallChannel({ appId: result.appId!, token: result.token, channel: result.channel!, uid: result.uid! }); } catch (e: any) { setState('ended'); setMessage(e.message); setTimeout(() => setState('idle'), 2500); } };
  const answerCall = async () => { if (!call) return; try { stopRing(); const result = await callApiRequest('/api/calls/accept', { callId: call.callId }); connectionRef.current = await joinCallChannel({ appId: result.appId!, token: result.token, channel: result.channel!, uid: result.uid! }); } catch (e: any) { setMessage(e.message); setState('ended'); } };
  const declineCall = async () => { if (!call) return; stopRing(); await callApiRequest('/api/calls/decline', { callId: call.callId }).catch(() => undefined); setState('idle'); setCall(null); sessionCallRef.current = null; };
  const endCall = async () => { if (!call) return; await callApiRequest('/api/calls/end', { callId: call.callId }).catch(() => undefined); await connectionRef.current?.leave?.().catch(() => undefined); connectionRef.current = null; stopRing(); };
  const toggleMute = async () => { const next = !muted; setMuted(next); await connectionRef.current?.setMuted?.(next); };
  return <Context.Provider value={{ callState: state, peerName: call?.peerName || 'Rider', elapsedSeconds: elapsed, formattedTime: format(elapsed), isMuted: muted, endedMessage: message, startCall, answerCall, declineCall, endCall, toggleMute }}>{children}</Context.Provider>;
}
export function useCall() { const value = useContext(Context); if (!value) throw new Error('useCall must be used within CallProvider'); return value; }
