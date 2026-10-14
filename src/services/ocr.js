import { supabase } from '../lib/supabase';

// Reads a keytag / window sticker photo via the `ocr-vehicle` Edge Function.
// Errors are worded for detailers; technical detail stays in the console.
export const scanVehicleFromImage = async ({ base64, mimeType, dataUrl }) => {
  const payload = dataUrl ? { dataUrl } : { imageBase64: base64, mimeType };
  const { data, error } = await supabase.functions.invoke('ocr-vehicle', { body: payload });
  if (error) {
    const status = error?.context?.status;
    console.log('ocr-vehicle failed', status, error?.message);
    if (!status)
      throw new Error("Can't reach the scanner. Check your signal, or type the details in.");
    throw new Error(
      "Couldn't read the tag. Try again with the tag flat and in focus, or type it in.",
    );
  }
  return data || {};
};
