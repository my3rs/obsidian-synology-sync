import en from './en';
import zhCN from './zh-cn';

const localeMap: Record<string, Record<string, string>> = {
	'en': en,
	'zh': zhCN,
	'zh-TW': zhCN, // fallback to simplified chinese for now
};

export function t(key: keyof typeof en, vars?: Record<string, string>): string {
	const lang = window.localStorage.getItem('language') || 'en';
	const dict = localeMap[lang] || localeMap['en'];
	
	let text = (dict && dict[key]) || en[key] || key as string;
	
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
		}
	}
	
	return text;
}
