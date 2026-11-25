import { Modal, Pressable, View } from 'react-native';
import { Languages, LogOut, Moon, Smartphone, Sun } from 'lucide-react-native';
import { radius, space, useTheme } from '../theme';
import { useLang } from '../i18n';
import { Button, T } from './ui';

const ROLE = { rider: 'Rider', driver: 'Driver', admin: 'Transportation office' };

/** A row of choices, e.g. Same as phone / Light / Night */
function Choices({ options, value, onChange }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.input, padding: 4 }}>
      {options.map((o) => {
        const on = value === o.value;
        const Icon = o.icon;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', backgroundColor: on ? t.surface : 'transparent' }}>
            {Icon && <Icon size={18} color={on ? t.goldText : t.muted} />}
            <T v="caption" color={on ? t.text : t.muted} style={{ marginTop: Icon ? 4 : 0, textAlign: 'center' }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Profile sheet: who is logged in, light / night / same as phone, language (drivers), and log out */
export default function ProfileMenu({ visible, user, onClose, onLogout }) {
  const { t, pref, setPref } = useTheme();
  const { tr, rtl, lang, setLang, canChoose } = useLang();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} accessibilityLabel={tr('Close')} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.xxl, paddingBottom: 40, borderWidth: t.mode === 'night' ? 1 : 0, borderColor: t.border }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.l }} />
          <T v="title1">{user?.name}</T>
          <T v="caption" color={t.muted}>{tr(ROLE[user?.role] ?? user?.role ?? '')}</T>

          {canChoose && (
            <>
              <T v="label" color={t.muted} style={{ marginTop: space.xxl, marginBottom: space.s }}>{tr('Language')}</T>
              <Choices
                value={lang}
                onChange={setLang}
                options={[{ value: 'ar', label: 'العربية', icon: Languages }, { value: 'en', label: 'English', icon: Languages }]}
              />
            </>
          )}

          <T v="label" color={t.muted} style={{ marginTop: space.xxl, marginBottom: space.s }}>{tr('Appearance')}</T>
          <Choices
            value={pref}
            onChange={setPref}
            options={[
              { value: 'system', label: tr('Same as phone'), icon: Smartphone },
              { value: 'light', label: tr('Light'), icon: Sun },
              { value: 'night', label: tr('Night'), icon: Moon },
            ]}
          />

          <Button title={tr('Log out')} kind="danger" icon={LogOut} onPress={() => { onClose(); onLogout(); }} style={{ marginTop: space.xxl }} />
        </View>
      </View>
    </Modal>
  );
}
