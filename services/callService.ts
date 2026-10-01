export type CallCredentials = { appId: string; token: string | null; channel: string; uid: string | number };
export type CallApiResponse = { success: boolean; callId?: string; channel?: string; appId?: string; token?: string; uid?: string | number; expiresAt?: number; error?: string };

export async function joinChannel(): Promise<{ leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void> }> {
  throw new Error('Voice calls are only supported on web for now');
}

export async function callApi(path: string, body: Record<string, unknown>): Promise<CallApiResponse> {
  throw new Error('Voice calls are only supported on web for now');
}
