export const formatUptime = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [
    days ? `${days}d` : null,
    days || hours ? `${hours}h` : null,
    days || hours || minutes ? `${minutes}m` : null,
    `${seconds % 60}s`,
  ];

  return parts.filter(Boolean).join(" ");
};
