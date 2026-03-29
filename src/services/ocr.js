import axios from 'axios';
import config from '../config/api';

export const scanVehicleFromImage = async ({ base64, mimeType, dataUrl }) => {
  const payload = dataUrl
    ? { dataUrl }
    : { imageBase64: base64, mimeType };

  try {
    const response = await axios.post(config.OCR_VEHICLE, payload, {
      timeout: 20000,
    });

    return response.data;
  } catch (error) {
    const parts = [];
    const status = error?.response?.status;
    const serverError = error?.response?.data?.error;
    const serverDetails = error?.response?.data?.details;

    if (status) parts.push(`HTTP ${status}`);
    if (serverError) parts.push(serverError);
    if (serverDetails) parts.push(String(serverDetails).slice(0, 500));

    if (!error?.response) {
      parts.push('Network error (no response from server)');
    }

    if (error?.code === 'ECONNABORTED') {
      parts.push('Request timed out');
    }

    parts.push(`URL: ${config.OCR_VEHICLE}`);

    throw new Error(parts.filter(Boolean).join('\n'));
  }
};
