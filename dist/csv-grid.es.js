/* csv-grid v3.5.0 — built by Vite from src/grid/ of the
* csv-viewer project. Generated file: do not edit. */
//#region src/grid/core.js
function e(e) {
	return (e ?? "").replace(/^\uFEFF/, "").replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, "");
}
function t(e) {
	let t = [
		",",
		"	",
		";",
		"|"
	], r = e.split(/\r\n|\n|\r/, 20).filter((e) => e.length), i = ",", a = 0;
	for (let e of t) {
		let t = r.map((t) => n(t, e).length), o = t[0];
		if (o < 2) continue;
		let s = o * (t.every((e) => e === o) ? 10 : 1);
		s > a && (a = s, i = e);
	}
	return i;
}
function n(e, t) {
	let n = [], r = "", i = !1;
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		i ? o === "\"" ? i = !1 : r += o : o === "\"" ? i = !0 : o === t ? (n.push(r), r = "") : r += o;
	}
	return n.push(r), n;
}
function r(e, t) {
	let n = [], r = [], i = "", a = !1, o = 0, s = e.length;
	for (; o < s;) {
		let s = e[o];
		if (a) {
			if (s === "\"") {
				if (e[o + 1] === "\"") {
					i += "\"", o += 2;
					continue;
				}
				a = !1, o++;
				continue;
			}
			i += s, o++;
			continue;
		}
		if (s === "\"") {
			a = !0, o++;
			continue;
		}
		if (s === t) {
			r.push(i), i = "", o++;
			continue;
		}
		if (s === "\r" || s === "\n") {
			r.push(i), i = "", n.push(r), r = [], s === "\r" && e[o + 1] === "\n" && o++, o++;
			continue;
		}
		i += s, o++;
	}
	for ((i.length || r.length) && (r.push(i), n.push(r)); n.length && n[n.length - 1].every((e) => e.trim() === "");) n.pop();
	return n;
}
function i(e) {
	e = e.trim(), e.startsWith("|") && (e = e.slice(1)), e.endsWith("|") && !e.endsWith("\\|") && (e = e.slice(0, -1));
	let t = [], n = "";
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		i === "\\" && e[r + 1] === "|" ? (n += "|", r++) : i === "|" ? (t.push(n), n = "") : n += i;
	}
	return t.push(n), t.map((e) => e.trim());
}
var a = /^:?-+:?$/;
function o(e) {
	let t = e.split(/\r\n|\n|\r/).filter((e) => e.trim() !== "");
	if (t.length < 2 || !t[0].includes("|")) return !1;
	let n = i(t[1]);
	return n.length > 0 && n.every((e) => a.test(e));
}
function s(e) {
	let t = e.split(/\r\n|\n|\r/).filter((e) => e.trim() !== ""), n = i(t[0]).map((e, t) => e || `col${t + 1}`), r = i(t[1]).map((e) => {
		let t = e.startsWith(":"), n = e.endsWith(":");
		return t && n ? "center" : n ? "right" : t ? "left" : null;
	});
	for (; r.length < n.length;) r.push(null);
	return {
		headers: n,
		rows: t.slice(2).filter((e) => e.includes("|")).map((e) => {
			let t = i(e).slice(0, n.length);
			for (; t.length < n.length;) t.push("");
			return t;
		}),
		aligns: r
	};
}
var c = /[$£€¥￥]/, l = /^\(?(?:[+-]?[$£€¥￥]?|[$£€¥￥][+-]?)(?:[0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?\)?$/, u = /^\(?[+-]?(?:inf(?:inity)?|∞)\)?$/i, d = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/, f = /^(\d{1,4})([\/\-.])(\d{1,2})\2(\d{1,4})$/, p = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?,?[ \-](\d{2,4})$/, m = /^([A-Za-z]{3,9})\.?,?[ \-](\d{1,2}),?[ \-](\d{2,4})$/, h = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december"
], g = new Set([
	"nan",
	"na",
	"n/a",
	"#n/a",
	"null",
	"none",
	"-",
	"--",
	"."
]);
function _(e) {
	return g.has((e ?? "").trim().toLowerCase());
}
function v(e) {
	if (e = e.trim(), u.test(e)) {
		let t = e;
		return t.startsWith("(") && t.endsWith(")") && (t = "-" + t.slice(1, -1)), {
			v: t.startsWith("-") ? -Infinity : Infinity,
			dec: 0
		};
	}
	if (!l.test(e)) return null;
	let t = !1;
	e.startsWith("(") && e.endsWith(")") && (t = !0, e = e.slice(1, -1));
	let n = "", r = c.exec(e);
	r && (n = r[0], e = e.replace(c, ""));
	let i = !1;
	e.endsWith("%") && (i = !0, e = e.slice(0, -1)), e = e.replace(/,/g, "");
	let a = parseFloat(e);
	if (!isFinite(a)) return null;
	t && (a = -a), i && (a /= 100);
	let o = /^([^eE]*)[eE]([+-]?\d+)$/.exec(e), s = o ? o[1] : e, d = o ? +o[2] : 0, f = s.indexOf("."), p = Math.max(0, (f < 0 ? 0 : s.length - f - 1) - d);
	return i && (p += 2), {
		v: a,
		dec: p,
		sym: n
	};
}
var y = "9007199254740991";
function ee(e) {
	return e = e.trim(), e.endsWith("%") || (e.startsWith("(") && e.endsWith(")") && (e = e.slice(1, -1)), e = e.replace(/[$£€¥￥,]/g, "").replace(/^[+-]/, ""), !/^\d+$/.test(e)) ? !1 : (e = e.replace(/^0+(?=\d)/, ""), e.length > 16 || e.length === 16 && e > y);
}
function b(e) {
	let t = e.toLowerCase(), n = h.findIndex((e) => e.startsWith(t) || t === "sept" && e === "september");
	return n < 0 || t.length < 3 ? null : n + 1;
}
function x(e) {
	return e = +e, e < 100 ? e < 50 ? 2e3 + e : 1900 + e : e;
}
function S(e, t, n, r = 0, i = 0, a = 0, o = !1) {
	let s = new Date(e, t - 1, n, r, i, a);
	return s.getFullYear() !== e || s.getMonth() !== t - 1 || s.getDate() !== +n ? null : {
		t: s.getTime(),
		hasTime: o
	};
}
function C(e, t = !1) {
	e = e.trim();
	let n = d.exec(e);
	if (n) {
		let [, e, t, r, i, a, o] = n;
		return S(+e, +t, +r, +(i || 0), +(a || 0), +(o || 0), i !== void 0);
	}
	if (n = f.exec(e), n) {
		let [, e, , r, i] = n;
		if (e.length === 4 && i.length <= 2) return S(+e, +r, +i);
		if (e.length <= 2 && (i.length === 4 || i.length === 2)) {
			let n = x(i);
			return +e > 12 && +r <= 12 ? S(n, +r, +e) : +r > 12 && +e <= 12 ? S(n, +e, +r) : t ? S(n, +r, +e) : S(n, +e, +r);
		}
		return null;
	}
	if (n = p.exec(e), n) {
		let e = b(n[2]);
		return e ? S(x(n[3]), e, +n[1]) : null;
	}
	if (n = m.exec(e), n) {
		let e = b(n[1]);
		return e ? S(x(n[3]), e, +n[2]) : null;
	}
	return null;
}
function w(e) {
	let t = f.exec(e.trim());
	if (!t) return null;
	let n = t[1], r = t[3], i = t[4];
	return n.length === 4 || !(i.length === 4 || i.length === 2) ? null : +n > 12 && +r <= 12 ? "day" : +r > 12 && +n <= 12 ? "month" : +n <= 12 && +r <= 12 ? "ambiguous" : null;
}
function te(e) {
	return e.some((e) => {
		let t = (e ?? "").trim();
		return t !== "" && (v(t) !== null || C(t) !== null);
	});
}
function ne(e) {
	let t = (e) => e.type === "date" ? "Date" : e.type === "number" ? e.format === "year" ? "Year" : "Amount" : "Description", n = {}, r = {};
	e.forEach((e) => {
		let r = t(e);
		n[r] = (n[r] || 0) + 1;
	}), e.forEach((e) => {
		let i = t(e);
		r[i] = (r[i] || 0) + 1, e.name = n[i] > 1 ? `${i} ${r[i]}` : i;
	});
}
var re = /\b(year|yr|vintage|cohort)\b/i, T = /\b(amount|amt|balance|bal|price|cost|fee|fees|charge|paid|payment|debit|credit|total|premium|loss|salary|wage|income|expense|revenue|usd|gbp|eur|cad)\b|[$£€]/i, E = /\b(id|no|num|number|account|acct|code|zip|postal|phone|fax|ssn|ein|tin|invoice|inv|ref|reference|sku|upc|isbn|order|customer|cust|member|policy|claim|seq)\b/i, D = /(?<![a-z])(ratio|rate|roe|roa|coc|lr|elr|plr|margin|yield|return|growth|retention|cede|ceded|discount|apr|apy|coupon|util|utilization|share|pct|percent|frequency)(?![a-z])/i;
function O(e, t, n, r = !1) {
	if (r) return {
		format: "float",
		dec: 2
	};
	let i = t.filter((e) => e !== null);
	if (i.every((e) => Number.isInteger(e)) && i.length) return re.test(e) || i.every((e) => e >= 1800 && e <= 2100) ? {
		format: "year",
		dec: 0
	} : E.test(e) && !T.test(e) ? {
		format: "plain",
		dec: 0
	} : T.test(e) ? {
		format: "float",
		dec: 2
	} : {
		format: "int",
		dec: 0
	};
	let a = 0, o = 0, s = Infinity, c = 0;
	for (let e of i) {
		if (e === 0 || !Number.isFinite(e)) continue;
		let t = Math.abs(e);
		a++, t > o && (o = t), t < s && (s = t), c += t;
	}
	if (!a) return {
		format: "float",
		dec: Math.min(n, 6)
	};
	if (D.test(e) && o <= 2) return {
		format: "pct",
		dec: Math.max(1, Math.min(4, n - 2))
	};
	if (T.test(e) || n <= 2 && o < 1e5) return {
		format: "float",
		dec: 2
	};
	if (o / s > 1e6) return {
		format: "eng",
		dec: 0
	};
	let l = c / a;
	return {
		format: "float",
		dec: Math.max(0, Math.min(n, 3 - Math.floor(Math.log10(l)), 6))
	};
}
var k = {
	"-9": "n",
	"-6": "µ",
	"-3": "m",
	0: "",
	3: "k",
	6: "M",
	9: "G",
	12: "T"
};
function A(e) {
	if (!Number.isFinite(e)) return e > 0 ? "inf" : "-inf";
	if (e === 0) return "0";
	let t = Math.abs(e), n = Math.floor(Math.log10(t) / 3) * 3;
	n = Math.max(-9, Math.min(12, n));
	let r = t / 10 ** n;
	return (e < 0 ? "-" : "") + Number(r.toPrecision(3)) + k[n];
}
function j(e, t) {
	if (e <= t) return Array.from({ length: e }, (e, t) => t);
	let n = Array(t), r = e / t;
	for (let e = 0; e < t; e++) n[e] = Math.floor(e * r);
	return n;
}
var M = 2048, N = /^-?0\d/;
function P(e, t) {
	let n = j(t.length, M);
	return e.map((e, r) => {
		let i = !0, a = !0, o = !1, s = !1, c = 0;
		for (let e of n) {
			let n = (t[e][r] ?? "").trim();
			if (!(n === "" || _(n)) && (c++, i && (v(n) === null ? i = !1 : (!o && N.test(n) && (o = !0), !s && ee(n) && (s = !0))), a && C(n, !1) === null && (a = !1), o || s || !i && !a)) break;
		}
		if (c === 0 || o || s) return s ? {
			name: e,
			type: "text",
			align: "right",
			values: null
		} : {
			name: e,
			type: "text",
			values: null
		};
		if (i) {
			let n = Array(t.length).fill(null), i = 0, a = !1;
			for (let e = 0; e < t.length; e++) {
				let o = (t[e][r] ?? "").trim();
				if (o === "" || _(o)) continue;
				let s = v(o);
				s && (n[e] = s.v, s.dec > i && (i = s.dec), s.sym && (a = !0));
			}
			let o = O(e, n, i, a);
			return {
				name: e,
				type: "number",
				format: o.format,
				dec: o.dec,
				hasCurrency: a,
				values: n
			};
		}
		if (a) {
			let n = !1, i = !1, a = !1, o = !1, s = Array(t.length).fill(null);
			for (let e = 0; e < t.length; e++) {
				let c = (t[e][r] ?? "").trim();
				if (c === "" || _(c)) continue;
				let l = C(c, !1);
				l && (s[e] = l.t, i ||= l.hasTime);
				let u = w(c);
				u === "day" ? (n = !0, o = !0) : u === "month" ? o = !0 : u === "ambiguous" && (a = !0);
			}
			if (n) {
				s = Array(t.length).fill(null);
				for (let e = 0; e < t.length; e++) {
					let n = (t[e][r] ?? "").trim();
					if (n === "" || _(n)) continue;
					let i = C(n, !0);
					i && (s[e] = i.t);
				}
			}
			return {
				name: e,
				type: "date",
				hasTime: i,
				ambiguousOrder: a && !o,
				values: s
			};
		}
		return {
			name: e,
			type: "text",
			values: null
		};
	});
}
function F(e, n = null) {
	let i, a, c = null, l;
	if (o(e)) {
		if ({headers: i, rows: a, aligns: c} = s(e), l = n === !1, l && (a = [i, ...a], i = i.map((e, t) => `col${t + 1}`)), !a.length) throw Error("Markdown table has no data rows.");
	} else {
		let o = r(e, t(e));
		if (o.length < 2) throw Error("Need a header row and at least one data row.");
		l = n === null ? te(o[0]) : !n, i = l ? o[0].map((e, t) => `col${t + 1}`) : o[0].map((e, t) => e.trim() || `col${t + 1}`), a = (l ? o : o.slice(1)).map((e) => {
			if (e.length === i.length) return e;
			let t = e.slice(0, i.length);
			for (; t.length < i.length;) t.push("");
			return t;
		});
	}
	let u = P(i, a);
	return l && ne(u), c && u.forEach((e, t) => {
		c[t] && (e.align = c[t]);
	}), {
		headers: u.map((e) => e.name),
		rows: a,
		cols: u,
		headerless: l
	};
}
//#endregion
//#region src/grid/util.js
var I = /* @__PURE__ */ new Map();
function L(e) {
	let t = I.get(e);
	return t || (t = new Intl.NumberFormat("en-US", {
		minimumFractionDigits: e,
		maximumFractionDigits: e
	}), I.set(e, t)), t;
}
function R(e) {
	if (e == null || e === "") return null;
	if (e === "year" || e === "eng") return { kind: e };
	let t = /^(,)?(?:\.(\d+))?([fd%es])$/.exec(e);
	if (!t) throw Error(`CsvGrid: unrecognized format spec '${e}'`);
	return {
		kind: t[3],
		comma: !!t[1],
		dec: t[2] === void 0 ? null : +t[2]
	};
}
var z = [
	[0xe8d4a51000, "T"],
	[1e9, "G"],
	[1e6, "M"],
	[1e3, "k"],
	[1, ""],
	[.001, "m"],
	[1e-6, "µ"],
	[1e-9, "n"]
];
function B(e, t) {
	switch (t.kind) {
		case "year": return String(e);
		case "eng": return A(e);
		case "d": {
			let n = Math.round(e);
			return t.comma ? L(0).format(n) : String(n);
		}
		case "f": {
			let n = t.dec ?? 2;
			return t.comma ? L(n).format(e) : e.toFixed(n);
		}
		case "%": {
			let n = t.dec ?? 0, r = e * 100;
			return (t.comma ? L(n).format(r) : r.toFixed(n)) + "%";
		}
		case "e": return e.toExponential(t.dec ?? 2);
		case "s": {
			if (t.dec === null || t.dec === void 0) return A(e);
			if (e === 0) return 0 .toFixed(t.dec);
			let n = Math.abs(e);
			for (let [r, i] of z) if (n >= r) return (e / r).toFixed(t.dec) + i;
			return (e / 1e-9).toFixed(t.dec) + "n";
		}
	}
}
function V(e) {
	return [...e].map((e) => ({
		l: "left",
		r: "right",
		c: "center"
	})[e] ?? null);
}
function ie(e, t, n, r = "auto") {
	if (e = (e ?? "").trim(), e === "") return "";
	if (r === "raw") return e;
	if (t.type === "number") {
		let r = t.values[n];
		if (r === null) return _(e) ? "" : e;
		if (!Number.isFinite(r)) return r > 0 ? "inf" : "-inf";
		if (t.fmt) return B(r, t.fmt);
		if (t.format === "year" || t.format === "plain") return String(r);
		if (t.format === "eng") return A(r);
		if (t.format === "pct") return L(t.dec).format(r * 100) + "%";
		let i = L(t.dec).format(r);
		if (t.hasCurrency) {
			let t = c.exec(e);
			if (t) return i[0] === "-" ? "-" + t[0] + i.slice(1) : t[0] + i;
		}
		return i;
	}
	if (t.type === "date") {
		let r = t.values[n];
		if (r === null) return _(e) ? "" : e;
		let i = new Date(r), a = (e) => String(e).padStart(2, "0"), o = `${i.getFullYear()}-${a(i.getMonth() + 1)}-${a(i.getDate())}`;
		return t.hasTime && (o += ` ${a(i.getHours())}:${a(i.getMinutes())}`), o;
	}
	return e;
}
function H(e, t) {
	let n = (e) => (e = (e ?? "") + "", /[",\r\n]/.test(e) ? "\"" + e.replace(/"/g, "\"\"") + "\"" : e), r = (e) => e.map(n).join(","), i = [r(e)];
	for (let e of t) i.push(r(e));
	return i.join("\r\n");
}
function U(e, t, n = []) {
	let r = (e) => ((e ?? "") + "").replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " "), i = (e) => e === "right" ? "---:" : e === "center" ? ":--:" : e === "left" ? ":---" : "---", a = (e) => "| " + e.map(r).join(" | ") + " |", o = "|" + e.map((e, t) => i(n[t])).join("|") + "|", s = [a(e), o];
	for (let e of t) s.push(a(e));
	return s.join("\n");
}
function W(e, t) {
	if (!Array.isArray(e)) throw Error("CsvGrid: records must be an array.");
	let n = (e) => e == null || typeof e == "number" && Number.isNaN(e) ? "" : String(e), r, i;
	if (e.length && Array.isArray(e[0])) {
		if (!t) throw Error("CsvGrid: columns are required with array-of-arrays records.");
		r = t.map(String), i = e.map((e) => r.map((t, r) => n(e[r])));
	} else r = (t ?? Object.keys(e[0] ?? {})).map(String), i = e.map((e) => r.map((t) => n(e[t])));
	let a = P(r, i);
	return {
		headers: r,
		rows: i,
		cols: a,
		headerless: !1
	};
}
function G(e) {
	let t = [];
	for (let n of e.trim().split(/\s+/)) {
		if (!n) continue;
		let e = {
			kind: "fuzzy",
			negate: !1
		};
		n.startsWith("!") && (e.negate = !0, e.kind = "exact", n = n.slice(1)), n.startsWith("'") && (e.kind = "exact", n = n.slice(1)), n.startsWith("^") && (e.kind = "prefix", n = n.slice(1)), n.endsWith("$") && (e.kind = e.kind === "prefix" ? "exact" : "suffix", n = n.slice(0, -1)), n && (e.cs = /[A-Z]/.test(n), e.str = e.cs ? n : n.toLowerCase(), t.push(e));
	}
	return t;
}
var K = /[\s_\-\/\\.,:;()[\]{}"']/;
function q(e, t) {
	let n = t.length, r = e.length;
	if (r === 0) return 0;
	if (r > n) return -1;
	let i = 0, a = -1;
	for (let o = 0; o < n; o++) if (t[o] === e[i] && (i++, i === r)) {
		a = o;
		break;
	}
	if (a < 0) return -1;
	i = r - 1;
	let o = a;
	for (let n = a; n >= 0 && !(t[n] === e[i] && (o = n, i--, i < 0)); n--);
	let s = 100 - 3 * (a - o + 1 - r) - Math.min(o, 20);
	i = 0;
	let c = !1;
	for (let n = o; n <= a && i < r; n++) t[n] === e[i] ? ((n === 0 || K.test(t[n - 1])) && (s += 8), c && (s += 4), c = !0, i++) : c = !1;
	return s;
}
function J(e, t, n) {
	let r = e.cs ? n : t, i, a = 0;
	switch (e.kind) {
		case "exact":
			i = r.includes(e.str);
			break;
		case "prefix":
			i = r.startsWith(e.str);
			break;
		case "suffix":
			i = r.endsWith(e.str);
			break;
		default: {
			let t = q(e.str, r);
			i = t >= 0, a = t;
		}
	}
	return e.negate && (i = !i), i ? a : -1;
}
function Y(e, t, n, r = "equal-risk") {
	return r === "coverage" ? oe(e, t, n) : ae(e, t, n);
}
function ae(e, t, n) {
	let r = (e, t) => e.length ? e[Math.floor(t * (e.length - 1))] : 0, i = (n) => e.map((e, i) => Math.max(t[i], r(e, n))), a = (e) => e.reduce((e, t) => e + t, 0), o = i(1);
	if (a(o) <= n) return o;
	if (a(i(0)) >= n) return i(0);
	let s = 0, c = 1;
	for (let e = 0; e < 32; e++) {
		let e = (s + c) / 2;
		a(i(e)) <= n ? s = e : c = e;
	}
	return i(s);
}
function oe(e, t, n) {
	let r = e.map((e, n) => Math.max(t[n], e.length ? e[e.length - 1] : 0)), i = (e) => e.reduce((e, t) => e + t, 0);
	if (i(r) <= n) return r;
	if (i(t) >= n) return t.slice();
	let a = t.slice(), o = n - i(t), s = [];
	for (let n = 0; n < e.length; n++) {
		let r = se(e[n], t[n]);
		for (let e = 1; e < r.length; e++) {
			let t = r[e].w - r[e - 1].w, i = r[e].cells - r[e - 1].cells;
			t > 0 && i > 0 && s.push({
				j: n,
				dw: t,
				slope: i / t
			});
		}
	}
	s.sort((e, t) => t.slope - e.slope);
	for (let e of s) {
		if (o <= 0) break;
		let t = Math.min(e.dw, o);
		a[e.j] += t, o -= t;
	}
	return a;
}
function se(e, t) {
	let n = e.length, r = 0;
	for (; r < n && e[r] <= t;) r++;
	let i = [{
		w: t,
		cells: r
	}];
	for (; r < n;) {
		let t = e[r];
		for (; r < n && e[r] === t;) r++;
		i.push({
			w: t,
			cells: r
		});
	}
	let a = [];
	for (let e of i) {
		for (; a.length >= 2;) {
			let t = a[a.length - 2], n = a[a.length - 1];
			if ((n.w - t.w) * (e.cells - t.cells) - (n.cells - t.cells) * (e.w - t.w) >= 0) a.pop();
			else break;
		}
		a.push(e);
	}
	return a;
}
function ce(e, t) {
	let n = e.trim();
	if (!n) return null;
	if (t.type === "number" || t.type === "date") {
		let e = t.type === "number" ? (e) => {
			let t = v(e);
			return t ? t.v : NaN;
		} : (e) => {
			let t = C(e);
			return t ? t.t : NaN;
		}, r = /^(>=|<=|>|<|=)\s*(.+)$/.exec(n);
		if (r) {
			let n = e(r[2]);
			if (!isNaN(n)) {
				let e = r[1];
				return (r, i) => {
					let a = t.values[i];
					if (a === null) return !1;
					switch (e) {
						case ">": return a > n;
						case ">=": return a >= n;
						case "<": return a < n;
						case "<=": return a <= n;
						default: return a === n;
					}
				};
			}
		}
		if (r = /^(.+?)\.\.(.+)$/.exec(n), r) {
			let n = e(r[1]), i = e(r[2]);
			if (!isNaN(n) && !isNaN(i)) return (e, r) => {
				let a = t.values[r];
				return a !== null && a >= n && a <= i;
			};
		}
	}
	let r = n.toLowerCase();
	return (e, t) => e.toLowerCase().includes(r);
}
function X(e) {
	return e.align ? `col-${e.type} align-${e.align}` : `col-${e.type}`;
}
function Z(e) {
	return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
//#endregion
//#region src/grid/grid.js
var le = 1e6, ue = 2048, Q = 1e4;
function $(e, t) {
	let n = document.createElement(e);
	return t && (n.className = t), n;
}
var de = class t {
	constructor(e, t, n = {}) {
		let r = typeof e == "string" ? document.querySelector(e) : e;
		if (!r) throw Error("CsvGrid: target element not found.");
		this.root = r, r.csvgrid = this, this.opts = {
			globalSearch: !0,
			columnFilters: !0,
			sortable: !0,
			statusBar: !0,
			expandButtons: !0,
			align: null,
			formats: null,
			renderCap: 2048,
			eagerCells: 262144,
			worker: !0,
			headerMode: "auto",
			widthMode: "equal-risk",
			maxRows: null,
			height: null,
			displayMode: "auto",
			selectable: !1,
			selectMode: "row",
			hiddenColumns: null,
			...n
		}, this.displayMode = this.opts.displayMode === "raw" ? "raw" : "auto", this.fileName = "", this.headers = [], this.rows = [], this.cols = [], this.formatted = [], this.searchRaw = null, this.searchLow = null, this.searchReady = !1, this.indexing = null, this.loadGen = 0, this.scores = [], this.layout = null, this.expandAll = !1, this.manualWidths = /* @__PURE__ */ new Map(), this.guessedHeaders = !1, this.ambiguousDateCols = [], this.view = [], this.sortCol = null, this.sortDir = 1, this.globalFilter = "", this.colFilters = [], this.showAll = !1, this.visibleCols = [], this.selected = null, this._worker = void 0, this._pending = /* @__PURE__ */ new Map(), this._buildScaffold(), t && this.setData(t);
	}
	_buildScaffold() {
		let e = this.opts, t = this.root;
		if (t.classList.add("csvgrid"), t.replaceChildren(), this.els = {}, e.globalSearch || e.expandButtons) {
			let n = $("div", "csvgrid-toolbar");
			if (e.globalSearch) {
				let e = $("input", "csvgrid-search");
				e.type = "text", e.placeholder = "fzf search: term 'exact !not ^pre fix$", e.title = "Space-separated terms AND together. Fuzzy by default; 'exact, !exclude, ^prefix, suffix$. Uppercase = case-sensitive.", e.addEventListener("input", () => this.setGlobalFilter(e.value)), e.addEventListener("keydown", (t) => {
					t.key === "Escape" && (t.preventDefault(), e.value = "", e.blur(), this.setGlobalFilter(""));
				}), n.appendChild(e), this.els.search = e;
			}
			if (e.expandButtons) {
				let e = $("button", "csvgrid-btn");
				e.type = "button", e.textContent = "Expand", e.title = "Expand all columns to their full natural width (table scrolls horizontally)", e.addEventListener("click", () => this.expand());
				let t = $("button", "csvgrid-btn");
				t.type = "button", t.textContent = "Contract", t.title = "Back to fitted widths (equal-risk squeeze); also clears any dragged widths", t.addEventListener("click", () => this.contract()), n.append(e, t);
			}
			t.appendChild(n);
		}
		let n = $("div", "csvgrid-scroll"), r = $("table", "csvgrid-table"), i = $("thead"), a = $("tbody");
		r.append(i, a), n.appendChild(r), t.appendChild(n);
		let o = $("div", "csvgrid-capnote csvgrid-hidden"), s = $("button", "csvgrid-btn");
		s.type = "button", s.addEventListener("click", () => {
			this.showAll = !0, this.renderBody(), this.renderStatus();
		}), o.appendChild(s), t.appendChild(o);
		let c = $("div", "csvgrid-error csvgrid-hidden");
		t.appendChild(c);
		let l = null;
		e.statusBar === !0 ? (l = $("div", "csvgrid-status"), t.appendChild(l)) : e.statusBar && (l = e.statusBar), Object.assign(this.els, {
			table: r,
			head: i,
			body: a,
			scroll: n,
			capNote: o,
			showAllBtn: s,
			error: c,
			status: l
		}), r.addEventListener("mouseover", (e) => {
			let t = e.target.closest("td, th");
			t && !t.title && t.scrollWidth > t.clientWidth && (t.title = t.textContent);
		}), this.opts.selectable && (t.dataset.selectable = "", a.addEventListener("click", (e) => this._onBodyClick(e)));
	}
	setData(e) {
		let t = ++this.loadGen, n = new Promise((n, r) => {
			this._resolveData(e, t).then(({ d: e, name: r }) => {
				t === this.loadGen && (this._install(e, r), n());
			}, (e) => {
				t === this.loadGen && (this._showError(e.message || String(e)), r(e));
			});
		});
		return n.catch(() => {}), n;
	}
	async _resolveData(e, t) {
		if (!e || typeof e != "object") throw Error("CsvGrid: data must be {csv}, {records[, columns]}, or {url}.");
		if (this._headerMode = e.headerMode ?? this.opts.headerMode, e.url !== void 0) {
			let n = String(e.url), r = e.name ?? decodeURIComponent(n.split("/").pop() || n), i = await fetch(n);
			if (!i.ok) throw Error(`HTTP ${i.status}`);
			return {
				d: await this._parse(await i.text(), t, r),
				name: r
			};
		}
		if (e.csv !== void 0) {
			let n = e.name ?? "";
			return {
				d: await this._parse(e.csv, t, n),
				name: n
			};
		}
		if (e.records !== void 0) return {
			d: W(e.records, e.columns),
			name: e.name ?? ""
		};
		throw Error("CsvGrid: data must be {csv}, {records[, columns]}, or {url}.");
	}
	_parse(t, n, r) {
		if (t = e(t), !t.trim()) throw Error("No data found.");
		let i = this._headerMode === "first-row" ? !0 : this._headerMode === "headerless" ? !1 : null, a = this.opts.worker !== !1 && t.length >= le ? this._getWorker() : null;
		return a ? (this._setStatus(`parsing ${r || "data"} (${(t.length / 1e6).toFixed(1)} MB)…`), new Promise((e, r) => {
			this._pending.set(n, {
				resolve: e,
				reject: r
			}), a.postMessage({
				gen: n,
				text: t,
				headerOverride: i
			});
		})) : F(t, i);
	}
	_getWorker() {
		if (this._worker === void 0) {
			this._worker = null;
			try {
				let e = typeof this.opts.worker == "string" ? new Worker(this.opts.worker) : new Worker(new URL(
					/* @vite-ignore */
					"" + new URL("csv-grid.worker.js", import.meta.url).href,
					"" + import.meta.url
				), { type: "module" });
				e.onmessage = (e) => {
					let { gen: t, result: n, error: r } = e.data, i = this._pending.get(t);
					i && (this._pending.delete(t), r ? i.reject(Error(r)) : i.resolve(n));
				}, e.onerror = () => {
					let e = [...this._pending.values()];
					this._pending.clear();
					for (let t of e) t.reject(/* @__PURE__ */ Error("Background parse failed."));
				}, this._worker = e;
			} catch {}
		}
		return this._worker;
	}
	_install(e, t) {
		let { rows: n, cols: r } = e;
		if (this.opts.align) {
			let e = V(this.opts.align);
			r.forEach((t, n) => {
				e[n] && (t.align = e[n]);
			});
		}
		this.opts.formats && r.forEach((e, t) => {
			e.fmt = R(this.opts.formats[t]);
		}), this.fileName = t || "", this.guessedHeaders = e.headerless, this.ambiguousDateCols = r.filter((e) => e.ambiguousOrder).map((e) => e.name), this.headers = e.headers, this.rows = n, this.cols = r;
		let i = Array.isArray(this.opts.hiddenColumns) && this.opts.hiddenColumns.length ? new Set(this.opts.hiddenColumns) : null;
		if (this.visibleCols = r.map((e, t) => t).filter((e) => !i || !i.has(this.headers[e])), this.selected = null, this.formatted = Array(n.length), this.searchRaw = null, this.searchLow = null, this.searchReady = !1, this.indexing = null, n.length * r.length <= this.opts.eagerCells) {
			for (let e = 0; e < n.length; e++) this.getFormattedRow(e);
			this.searchRaw = this.formatted.map((e, t) => e.join(" ") + " " + n[t].join(" ")), this.searchLow = this.searchRaw.map((e) => e.toLowerCase()), this.searchReady = !0;
		}
		this.sortCol = null, this.sortDir = 1, this.globalFilter = "", this.colFilters = Array(r.length).fill(""), this.manualWidths = /* @__PURE__ */ new Map(), this.showAll = !1, this.els.search && (this.els.search.value = ""), this.els.error.classList.add("csvgrid-hidden"), this.renderHead(), this.layout = this.measureLayout(), this.applyLayout(), this.refresh(), this._applyHeight();
	}
	_applyHeight() {
		let e = this.opts;
		if (e.height) {
			this.els.scroll.style.maxHeight = e.height;
			return;
		}
		if (e.maxRows && this.els.body.rows.length) {
			let t = this.els.head.offsetHeight, n = this.els.body.rows[0].offsetHeight;
			this.els.scroll.style.maxHeight = Math.ceil(t + n * e.maxRows + 2) + "px";
		}
	}
	_showError(e) {
		this.els.error.textContent = e, this.els.error.classList.remove("csvgrid-hidden");
	}
	_setStatus(e) {
		this.els.status && (this.els.status.textContent = e);
	}
	destroy() {
		this.loadGen++, this._pending.clear(), this._worker &&= (this._worker.terminate(), null), delete this.root.csvgrid, this.root.classList.remove("csvgrid"), delete this.root.dataset.selectable, this.root.replaceChildren();
	}
	setGlobalFilter(e) {
		this.globalFilter = e, this.refresh();
	}
	clearFilters() {
		this.globalFilter = "", this.colFilters = this.colFilters.map(() => ""), this.els.search && (this.els.search.value = ""), this.renderHead(), this.refresh();
	}
	expand() {
		this.expandAll = !0, this.applyLayout();
	}
	contract() {
		this.expandAll = !1, this.manualWidths.clear(), this.applyLayout();
	}
	export({ scope: e = "view", format: t = "csv", values: n = "raw" } = {}) {
		let r = e === "all" ? this.rows.map((e, t) => t) : this.view, i = n === "formatted" && r.length <= this.opts.renderCap, a = r.map((e) => i ? this.getFormattedRow(e) : this.cols.map((t, n) => this.rows[e][n] ?? ""));
		if (t === "md") {
			let e = this.cols.map((e) => e.align || (e.type === "number" ? "right" : e.type === "date" ? "center" : "left"));
			return U(this.headers, a, e);
		}
		return H(this.headers, a);
	}
	setWidthMode(e) {
		this.opts.widthMode = e === "coverage" ? "coverage" : "equal-risk", this.applyLayout();
	}
	setDisplayMode(e) {
		if (e = e === "raw" ? "raw" : "auto", e === this.displayMode || !this.cols.length) {
			this.displayMode = e;
			return;
		}
		if (this.displayMode = e, this.formatted = Array(this.rows.length), this.searchRaw = null, this.searchLow = null, this.searchReady = !1, this.indexing = null, this.rows.length * this.cols.length <= this.opts.eagerCells) {
			for (let e = 0; e < this.rows.length; e++) this.getFormattedRow(e);
			this.searchRaw = this.formatted.map((e, t) => e.join(" ") + " " + this.rows[t].join(" ")), this.searchLow = this.searchRaw.map((e) => e.toLowerCase()), this.searchReady = !0;
		}
		this.layout = this.measureLayout(), this.applyLayout(), this.refresh();
	}
	measureLayout() {
		let e = (t._canvas ||= document.createElement("canvas")).getContext("2d"), n = getComputedStyle(this.els.table), r = `${n.fontSize} ${n.fontFamily}`, i = j(this.rows.length, ue), a = [], o = [];
		for (let t of this.visibleCols) {
			e.font = `bold ${r}`, o.push(Math.max(50, Math.ceil(e.measureText(this.cols[t].name).width) + 14 + 18)), e.font = r;
			let n = [];
			for (let r of i) {
				let i = this.getFormattedRow(r)[t];
				i !== "" && n.push(Math.ceil(e.measureText(i).width) + 18);
			}
			n.sort((e, t) => e - t), a.push(n);
		}
		return {
			arrays: a,
			floors: o
		};
	}
	startColResize(e, t) {
		e.preventDefault(), e.stopPropagation();
		let n = this.els.table, r = n.querySelectorAll("colgroup col")[t];
		if (!r) return;
		let i = e.clientX, a = parseFloat(r.style.width);
		document.body.classList.add("csvgrid-resizing");
		let o = () => {
			let e = 0;
			n.querySelectorAll("colgroup col").forEach((t) => {
				e += parseFloat(t.style.width);
			}), n.style.width = e + "px";
		}, s = (e) => {
			let n = Math.max(24, Math.round(a + e.clientX - i));
			this.manualWidths.set(t, n), r.style.width = n + "px", o();
		}, c = () => {
			document.body.classList.remove("csvgrid-resizing"), document.removeEventListener("mousemove", s), document.removeEventListener("mouseup", c);
		};
		document.addEventListener("mousemove", s), document.addEventListener("mouseup", c);
	}
	fitColumn(e) {
		let { arrays: t, floors: n } = this.layout, r = Math.max(n[e], t[e].length ? t[e][t[e].length - 1] : 0);
		this.manualWidths.set(e, r), this.applyLayout();
	}
	applyLayout() {
		if (!this.layout) return;
		let e = this.els.table, t = this.expandAll ? Infinity : e.parentElement.clientWidth;
		if (!t) return;
		let n = Y(this.layout.arrays, this.layout.floors, t, this.opts.widthMode);
		for (let [e, t] of this.manualWidths) e < n.length && (n[e] = t);
		let r = e.querySelector("colgroup");
		r && r.remove(), r = document.createElement("colgroup");
		for (let e of n) {
			let t = document.createElement("col");
			t.style.width = e + "px", r.appendChild(t);
		}
		e.prepend(r), e.style.tableLayout = "fixed", e.style.width = n.reduce((e, t) => e + t, 0) + "px";
	}
	getFormattedRow(e) {
		let t = this.formatted[e];
		return t || (t = this.cols.map((t, n) => ie(this.rows[e][n], t, e, this.displayMode)), this.formatted[e] = t), t;
	}
	buildSearchIndexChunked() {
		let e = this.loadGen, t = this.rows.length, n = Array(t), r = Array(t), i = 0;
		this.indexing = 0;
		let a = () => {
			if (e !== this.loadGen) return;
			let o = Math.min(t, i + Q);
			for (; i < o; i++) {
				let e = this.getFormattedRow(i).join(" ") + " " + this.rows[i].join(" ");
				n[i] = e, r[i] = e.toLowerCase();
			}
			i < t ? (this.indexing = i / t, this.renderStatus(), setTimeout(a, 0)) : (this.searchRaw = n, this.searchLow = r, this.searchReady = !0, this.indexing = null, this.refresh());
		};
		a();
	}
	rebuildView() {
		let { rows: e, cols: t } = this, n = G(this.globalFilter);
		n.length && !this.searchReady && (this.indexing === null && this.buildSearchIndexChunked(), n = []);
		let r = n.some((e) => e.kind === "fuzzy" && !e.negate), i = this.colFilters.map((e, n) => ce(e || "", t[n])), a = i.some((e) => e) || n.length, o = [];
		this.scores = [];
		for (let t = 0; t < e.length; t++) {
			let r = 0;
			if (a) {
				let a = !0;
				for (let e of n) {
					let n = J(e, this.searchLow[t], this.searchRaw[t]);
					if (n < 0) {
						a = !1;
						break;
					}
					r += n;
				}
				if (a) {
					for (let n = 0; n < i.length; n++) if (i[n] && !i[n](e[t][n] ?? "", t)) {
						a = !1;
						break;
					}
				}
				if (!a) continue;
			}
			this.scores[t] = r, o.push(t);
		}
		let s = this.sortCol;
		if (s === null && r) o.sort((e, t) => this.scores[t] - this.scores[e] || e - t);
		else if (s !== null) {
			let e = this.cols[s], t = this.sortDir;
			if (e.type === "text") {
				let e = new Intl.Collator("en", {
					sensitivity: "base",
					numeric: !0
				});
				o.sort((n, r) => {
					let i = (this.rows[n][s] ?? "").trim(), a = (this.rows[r][s] ?? "").trim();
					return i === "" || a === "" ? i === a ? 0 : i === "" ? 1 : -1 : t * e.compare(i, a);
				});
			} else o.sort((n, r) => {
				let i = e.values[n], a = e.values[r];
				return i === null || a === null ? i === a ? 0 : i === null ? 1 : -1 : t * (i - a);
			});
		}
		this.view = o;
	}
	renderHead() {
		let { cols: e } = this, t = this.els.head;
		t.innerHTML = "";
		let n = document.createElement("tr");
		if (this.visibleCols.forEach((t, r) => {
			let i = e[t], a = document.createElement("th");
			a.className = X(i), this.opts.sortable ? (a.innerHTML = `<span class="sort-arrow">${this.sortCol === t ? this.sortDir === 1 ? "▲" : "▼" : ""}</span>${Z(i.name)}`, a.title = `${i.name} (${i.type}) — click to sort`, a.addEventListener("click", () => this.onSort(t))) : (a.innerHTML = `<span class="sort-arrow"></span>${Z(i.name)}`, a.title = `${i.name} (${i.type})`, a.classList.add("csvgrid-nosort"));
			let o = document.createElement("span");
			o.className = "col-resizer", o.title = "Drag to resize — double-click to fit content", o.addEventListener("mousedown", (e) => this.startColResize(e, r)), o.addEventListener("dblclick", (e) => {
				e.stopPropagation(), this.fitColumn(r);
			}), o.addEventListener("click", (e) => e.stopPropagation()), a.appendChild(o), n.appendChild(a);
		}), t.appendChild(n), !this.opts.columnFilters) return;
		let r = document.createElement("tr");
		r.className = "filter-row", this.visibleCols.forEach((t) => {
			let n = e[t], i = document.createElement("th"), a = document.createElement("input");
			a.type = "text", a.className = "csvgrid-filter", a.placeholder = n.type === "text" ? "filter" : "filter, >, .. ", a.value = this.colFilters[t] || "", a.addEventListener("input", () => {
				this.colFilters[t] = a.value, a.classList.toggle("active-filter", a.value.trim() !== ""), this.refresh();
			}), a.addEventListener("keydown", (e) => {
				e.key === "Escape" && (e.preventDefault(), a.value = "", this.colFilters[t] = "", a.classList.remove("active-filter"), a.blur(), this.refresh());
			}), i.appendChild(a), r.appendChild(i);
		}), t.appendChild(r);
	}
	renderBody() {
		let { cols: e, view: t } = this, n = this.showAll ? t.length : Math.min(t.length, this.opts.renderCap), r = this.opts.selectable, i = [];
		for (let a = 0; a < n; a++) {
			let n = t[a], o = this.getFormattedRow(n), s = this.visibleCols.map((t) => {
				let n = e[t], r = o[t];
				return r === "" ? `<td class="${X(n)} blank">·</td>` : `<td class="${X(n)}">${Z(r)}</td>`;
			});
			i.push(`<tr${r ? ` data-r="${n}"` : ""}>${s.join("")}</tr>`);
		}
		this.els.body.innerHTML = i.join(""), r && this._paintSelection();
		let a = this.els.capNote;
		t.length > n ? (a.classList.remove("csvgrid-hidden"), this.els.showAllBtn.textContent = `Showing first ${n.toLocaleString()} of ${t.length.toLocaleString()} rows — show all`) : a.classList.add("csvgrid-hidden");
	}
	renderStatus() {
		if (!this.els.status) return;
		let e = (e) => e.toLocaleString(), t = this.rows.length, n = this.view.length, r = this.showAll ? n : Math.min(n, this.opts.renderCap), i = this.fileName ? this.fileName + " — " : "";
		i += n === t ? `${e(t)} rows` : `${e(n)} of ${e(t)} rows`, i += ` × ${this.cols.length} cols`, r < n && (i += ` — showing rows 1–${e(r)}`), this.guessedHeaders && (i += " (headers guessed)"), this.indexing !== null && (i += ` — indexing search ${Math.round(this.indexing * 100)}%`), this.els.status.textContent = i;
	}
	refresh() {
		this.rebuildView(), this.renderBody(), this.renderStatus();
	}
	onSort(e) {
		this.sortCol === e ? this.sortDir === 1 ? this.sortDir = -1 : (this.sortCol = null, this.sortDir = 1) : (this.sortCol = e, this.sortDir = 1), this.renderHead(), this.refresh();
	}
	static forElement(e) {
		let t = typeof e == "string" ? document.querySelector(e) : e;
		return t && t.csvgrid || null;
	}
	_rawValue(e, t) {
		let n = this.cols[t];
		if (n && n.type === "number") {
			let t = n.values[e];
			if (t != null) return t;
		}
		return this.rows[e][t] ?? null;
	}
	_rowDetail(e, t, n) {
		let r = this.getFormattedRow(e), i = {}, a = {};
		return this.headers.forEach((t, n) => {
			i[t] = this._rawValue(e, n), a[t] = r[n] ?? "";
		}), {
			name: this.fileName,
			rowIndex: e,
			viewIndex: this.view.indexOf(e),
			column: this.headers[t],
			columnIndex: t,
			value: this._rawValue(e, t),
			valueText: r[t] ?? "",
			row: i,
			rowText: a,
			originalEvent: n
		};
	}
	_onBodyClick(e) {
		let t = e.target.closest("td"), n = t && t.parentElement;
		if (!t || !n || n.dataset.r === void 0) return;
		let r = +n.dataset.r, i = [...n.children].indexOf(t), a = this.visibleCols[i];
		if (a === void 0) return;
		let o = new CustomEvent("csvgrid:cellclick", {
			detail: this._rowDetail(r, a, e),
			bubbles: !0,
			composed: !0,
			cancelable: !0
		});
		this.root.dispatchEvent(o) && this.opts.selectMode !== "none" && (this.selected = {
			rowIndex: r,
			columnIndex: a
		}, this._paintSelection());
	}
	_paintSelection() {
		let e = this.els.body;
		if (e.querySelectorAll(".csvgrid-selected, .csvgrid-selected-row").forEach((e) => e.classList.remove("csvgrid-selected", "csvgrid-selected-row")), !this.selected || this.opts.selectMode === "none") return;
		let t = e.querySelector(`tr[data-r="${this.selected.rowIndex}"]`);
		if (t) if (this.opts.selectMode === "cell") {
			t.classList.add("csvgrid-selected-row");
			let e = t.children[this.visibleCols.indexOf(this.selected.columnIndex)];
			e && e.classList.add("csvgrid-selected");
		} else t.classList.add("csvgrid-selected");
	}
	getSelection() {
		return this.selected ? this._rowDetail(this.selected.rowIndex, this.selected.columnIndex, null) : null;
	}
	clearSelection() {
		this.selected = null, this.opts.selectable && this._paintSelection();
	}
	selectRow(e) {
		if (!this.opts.selectable) return;
		this.selected = {
			rowIndex: e,
			columnIndex: this.selected ? this.selected.columnIndex : this.visibleCols[0]
		}, this._paintSelection();
		let t = this.els.body.querySelector(`tr[data-r="${e}"]`);
		t && t.scrollIntoView({ block: "nearest" });
	}
};
//#endregion
export { de as default };

//# sourceMappingURL=csv-grid.es.js.map