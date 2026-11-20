export const colors = {
  primary: '#1F4E79',
  primaryLight: '#E8EFF6',
  text: '#1B1F24',
  muted: '#5F6B76',
  border: '#DDE3E9',
  background: '#F5F7F9',
  card: '#FFFFFF',
  good: '#1E7B45',
  warning: '#B45F06',
  danger: '#B3261E',
  info: '#1F4E79',
  neutral: '#6B7280',
};

// The colour of each status label the backend sends
export const statusColor = {
  'On time': colors.good,
  Delayed: colors.warning,
  'Not started': colors.neutral,
  Arrived: colors.info,
  Cancelled: colors.danger,
};

export const directionText = { inbound: 'To campus', outbound: 'From campus' };
