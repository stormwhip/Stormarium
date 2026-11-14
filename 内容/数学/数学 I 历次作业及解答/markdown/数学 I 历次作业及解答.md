# 数学 I 历次作业及解答

1. $\displaystyle\lim_{x\to0}\frac{\tan x-\sin x}{x^3}$

利用 $\sin x\sim x$、$1-\cos x\sim \frac{x^2}{2}$，先变形得

$$
\frac{\tan x-\sin x}{x^3}
=\frac{\sin x(1-\cos x)}{x^3\cos x}
\longrightarrow\boxed{\frac12}.
$$

---

2. $\displaystyle\lim_{x\to0}\frac{(x+1)\sin5x}{\tan2x}$

由 $\sin5x\sim5x$、$\tan2x\sim2x$，得

$$
\lim_{x\to0}\frac{(x+1)\sin5x}{\tan2x}
=\lim_{x\to0}(x+1)\frac{5x}{2x}
=\boxed{\frac52}.
$$

---

3. $\displaystyle\lim_{x\to0}\frac{\sqrt[3]{1+5x^2}-1}{\ln(1+x)\arctan(\frac{x}{2})}$

因为

$$
\sqrt[3]{1+5x^2}-1\sim\frac53x^2,\qquad
\ln(1+x)\sim x,\qquad \arctan(\frac{x}{2})\sim\frac{x}{2},
$$

所以原极限为 $\displaystyle\frac{\frac{5}{3}}{\frac{1}{2}}=\boxed{\frac{10}{3}}$。

---

4. $\displaystyle\lim_{x\to0}\left[(1+\sin^2x)^{\frac{\ln(1+x)}{1-\cos x}}-1\right]$

令 $\displaystyle u=\frac{\ln(1+x)\ln(1+\sin^2x)}{1-\cos x}$。由

$$
\ln(1+x)\sim x,\qquad
\ln(1+\sin^2x)\sim\sin^2x\sim x^2,\qquad
1-\cos x\sim\frac{x^2}{2},
$$

得 $u\sim2x\to0$。于是原式 $=e^u-1\sim u\to\boxed{0}$。

---

5. $\displaystyle\lim_{x\to1}\frac{\ln\cos(x-1)}{1-\sin(\frac{\pi x}{2})}$

令 $t=x-1\to0$，则

$$
\ln\cos t=\ln\bigl[1+(\cos t-1)\bigr]
\sim\cos t-1\sim-\frac{t^2}{2},
$$

$$
1-\sin(\frac{\pi x}{2})=1-\cos(\frac{\pi t}{2})
\sim\frac{\pi^2t^2}{8}.
$$

故原极限为 $\displaystyle\frac{-\frac{1}{2}}{\frac{\pi^2}{8}}=\boxed{-\frac4{\pi^2}}$。

---

6. $\displaystyle\lim_{x\to+\infty}\left(x+\sqrt{1+x^2}\right)^{\frac{1}{x}}$

**方法一：** 令 $t=\frac{1}{x}\to0^+$，记原式为 $y$。由

$$
\delta=\frac{\sqrt{1+t^2}-1}{2}\sim\frac{t^2}{4},\qquad
\ln(1+\delta)\sim\delta\sim\frac{t^2}{4},
$$

得

$$
\ln y=t\ln\frac{1+\sqrt{1+t^2}}{t}
=t\ln\frac2t+t\ln(1+\delta)\longrightarrow0.
$$

这里用到基本极限 $t\ln t\to0$（$t\to0^+$）。因此 $y\to\boxed{1}$。

**方法二：** 当 $x\ge1$ 时，$1<x+\sqrt{1+x^2}\le3x$。利用 $\ln v\le v-1$（$v>0$），有

$$
0\le\frac{\ln(x+\sqrt{1+x^2})}{x}
\le\frac{\ln(3x)}{x}
=\frac{2\ln\sqrt{3x}}{x}
\le\frac{2(\sqrt{3x}-1)}{x}\longrightarrow0.
$$

因此，$\ln y\to0$，故 $y\to\boxed{1}$。

---

7. $\displaystyle\lim_{n\to\infty}\left(\frac1{n^2+1}+\frac2{n^2+2}+\cdots+\frac n{n^2+n}\right)$

记括号内的和为 $S_n$。当 $1\le k\le n$ 时，

$$
\frac{k}{n^2+n}\le\frac{k}{n^2+k}\le\frac{k}{n^2+1}.
$$

求和并利用 $\displaystyle\sum_{k=1}^n k=\frac{n(n+1)}2$，得

$$
\frac12\le S_n\le\frac{n(n+1)}{2(n^2+1)}\longrightarrow\frac12.
$$

因此，原极限为 $\boxed{\frac12}$。

---

8. 求三次函数 $Q(x)=ax^3+bx^2+cx+d$ 的拐点。

因为 $a\ne0$，且

$$
Q'(x)=3ax^2+2bx+c,\qquad Q''(x)=6ax+2b,
$$

令 $Q''(x)=0$，得 $\displaystyle x_*=-\frac{b}{3a}$。由于
$Q''(x)=6a(x-x_*)$ 在 $x_*$ 两侧异号，故拐点为

$$
\boxed{\left(-\frac{b}{3a},\ Q\!\left(-\frac{b}{3a}\right)\right)}.
$$

---

9. 求圆的曲率半径，其中

$$
\begin{cases}
x=x_0+R\cos\theta,\\
y=y_0+R\sin\theta,
\end{cases}
\qquad R>0.
$$

对 $\theta$ 求导，得

$$
\begin{aligned}
x'&=-R\sin\theta,& y'&=R\cos\theta,\\
x''&=-R\cos\theta,& y''&=-R\sin\theta.
\end{aligned}
$$

因此曲率半径为

$$
\rho=\frac{\bigl[(x')^2+(y')^2\bigr]^{\frac32}}
{|x'y''-y'x''|}
=\frac{(R^2)^{\frac32}}{R^2}
=\boxed{R}.
$$

---

10. $\displaystyle\lim_{n\to\infty}n\left(\arctan n-\frac\pi2\right)$

由 $n>0$ 时 $\arctan n+\arctan\frac1n=\frac\pi2$，得

$$
n\left(\arctan n-\frac\pi2\right)
=-\frac{\arctan(1/n)}{1/n}\longrightarrow\boxed{-1}.
$$

---

11. $\displaystyle\lim_{n\to\infty}\left[\frac{(1+\frac1n)^n}{e}\right]^n$

记原式为 $a_n>0$。利用 $\ln(1+t)=t-\frac{t^2}{2}+O(t^3)$（$t\to0$），得

$$
\begin{aligned}
\ln a_n
&=n\left[n\ln\left(1+\frac1n\right)-1\right]\\
&=n\left[-\frac1{2n}+O\left(\frac1{n^2}\right)\right]
\longrightarrow-\frac12.
\end{aligned}
$$

因此原极限为 $\boxed{e^{-1/2}}$。

---

12. $\displaystyle\lim_{n\to\infty}\frac{n^{100}\ln^{10}n}{2^n}$

令 $a_n=\frac{n^{100}\ln^{10}n}{2^n}$（$n\ge2$），则

$$
\frac{a_{n+1}}{a_n}
=\frac12\left(1+\frac1n\right)^{100}
\left(\frac{\ln(n+1)}{\ln n}\right)^{10}
\longrightarrow\frac12<1.
$$

取 $\frac12<q<1$，则存在 $N$，使 $n\ge N$ 时 $a_{n+1}\le q a_n$，从而
$0<a_n\le a_Nq^{n-N}\to0$。故原极限为 $\boxed{0}$。

---

13. $\displaystyle\lim_{n\to\infty}\frac{2^n\cdot(n!)\cdot\ln^{10}n}{n^n}$

令 $b_n=\frac{2^n\cdot(n!)\cdot\ln^{10}n}{n^n}$（$n\ge2$），则

$$
\begin{aligned}
\frac{b_{n+1}}{b_n}
&=2\left(\frac n{n+1}\right)^n
\left(\frac{\ln(n+1)}{\ln n}\right)^{10}\\
&\longrightarrow\frac2e<1.
\end{aligned}
$$

由第 12 题的几何数列估计可知 $b_n\to0$，故原极限为 $\boxed{0}$。

---

14. $\displaystyle\lim_{n\to\infty}\frac{n^n(n+1)^{10}}{3^n n!}$

令 $c_n=\frac{n^n(n+1)^{10}}{3^n n!}>0$，则

$$
\begin{aligned}
\frac{c_{n+1}}{c_n}
&=\frac13\left(1+\frac1n\right)^n
\left(\frac{n+2}{n+1}\right)^{10}\\
&\longrightarrow\frac e3<1.
\end{aligned}
$$

由第 12 题的几何数列估计可知 $c_n\to0$，故原极限为 $\boxed{0}$。

---

15. 若 $\displaystyle\lim_{x\to-\infty}\left(\sqrt{x^2+x+1}+ax+b\right)=0$，求 $a,b$。

当 $x\to-\infty$ 时，令 $u=\frac1x+\frac1{x^2}$，则 $u\to0$。由 $(1+u)^{1/2}-1\sim\frac u2$，得

$$
\sqrt{x^2+x+1}=-x\sqrt{1+u},\qquad
\sqrt{x^2+x+1}+x=-x\bigl(\sqrt{1+u}-1\bigr)\longrightarrow-\frac12.
$$

因此原式可写为 $(a-1)x+b+\left(\sqrt{x^2+x+1}+x\right)$。由极限为零，得 $a-1=0$，$b-\frac12=0$，所以

$$
\boxed{a=1,\qquad b=\frac12}.
$$

---

16. 若 $\displaystyle\lim_{x\to\infty}\left(\frac{x^2+1}{x+1}-ax+b\right)=3$，求 $a,b$。

由多项式除法，得

$$
\frac{x^2+1}{x+1}-ax+b=(1-a)x+b-1+\frac2{x+1}.
$$

由极限为 $3$，得 $1-a=0$，$b-1=3$，所以

$$
\boxed{a=1,\qquad b=4}.
$$
