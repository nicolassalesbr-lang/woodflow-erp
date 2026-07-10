export const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3012';
    }
    const protocol = window.location.protocol;
    return `${protocol}//${host}/woodflow-api`;
  }
  return 'http://localhost:3012';
};
