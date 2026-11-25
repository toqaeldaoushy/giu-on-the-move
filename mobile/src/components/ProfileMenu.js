import { Modal, Pressable, View } from 'react-native';
import { LogOut, Moon, Smartphone, Sun } from 'lucide-react-native';
import { radius, space, useTheme } from '../theme';
import { Button, T } from './ui';

const ROLE = { rider: 'Rider', driver: 'Driver', admin: 'Transportation office' };

/** Profile sheet: who is logged in, light / night / same as phone, and log out */
export default function ProfileMenu({ visible, user, onClose, onLogout }) {
  const { t, pref, setPref } = useTheme();
  const options = [
    { value: 'system', label: 'Same as phone', icon: Smartphone },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'night', label: 'Night', icon: Moon },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.xxl, paddingBottom: 40, borderWidth: t.mode === 'night' ? 1 : 0, borderColor: t.border }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.l }} />
        <T v="title1">{user?.name}</T>
        <T v="caption" color={t.muted}>{ROLE[user?.role] ?? user?.role}</T>

        <T v="label" color={t.muted} style={{ marginTop: space.xxl, marginBottom: space.s }}>Appearance</T>
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.input, padding: 4 }}>
          {options.map((o) => {
            const on = pref === o.value;
            const Icon = o.icon;
            return (
              <Pressable key={o.value} onPress={() => setPref(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', backgroundColor: on ? t.surface : 'transparent' }}>
                <Icon size={18} color={on ? t.goldText : t.muted} />
                <T v="caption" color={on ? t.text : t.muted} style={{ marginTop: 4 }}>{o.label}</T>
              </Pressable>
            );
          })}
        </View>

        <Button title="Log out" kind="danger" icon={LogOut} onPress={() => { onClose(); onLogout(); }} style={{ marginTop: space.xxl }} />
      </View>
    </Modal>
  );
}
