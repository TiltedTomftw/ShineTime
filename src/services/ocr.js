import { supabase } from '../lib/supabase';

export const scanVehicleFromImage = async ({ base64, mimeType, dataUrl }) => {
  const payload = dataUrl ? { dataUrl } : { imageBase64: base64, mimeType };

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Not authenticated. Please sign in again.');
    }

    const { data, error } = await supabase.functions.invoke('ocr-vehicle', {
      body: payload,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    const parts = [];
    const status = error?.context?.status;
    const serverError = error?.context?.error || error?.message;
    const serverDetails = error?.context?.details;

    if (status) parts.push(`HTTP ${status}`);
    if (serverError) parts.push(serverError);
    if (serverDetails) parts.push(String(serverDetails).slice(0, 500));
    parts.push('Function: ocr-vehicle');

    throw new Error(parts.filter(Boolean).join('\n'));
  }
};
