export const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3009';
    }
    return `http://${host}:3009`;
  }
  return 'http://localhost:3009';
};
