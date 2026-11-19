# MIT 18.06 线性代数计算笔记

Lecture 20 选编　｜　2026-11-19

## Lecture 20：克拉默法则、逆矩阵与体积

Lecture 19 给出了代数余子式展开。本讲用它写出逆矩阵的显式公式和线性方程组的解，并用行列式描述线性变换对面积、体积及定向的影响。

### 20.1 用代数余子式构造逆矩阵

**适用**　已知可逆方阵，需要写出逆矩阵的显式公式，或证明代数余子式与逆矩阵之间的关系。

**步骤**　对 $n$ 阶矩阵 $A=(a_{ij})$，删去第 $i$ 行、第 $j$ 列所得矩阵记为 $A_{ij}$。代数余子式（Cofactor）为
$$
C_{ij}=(-1)^{i+j}\det A_{ij}.
$$
把各个 $C_{ij}$ 排成矩阵 $C=(C_{ij})$，其转置称为伴随矩阵（Adjugate Matrix），记为 $\operatorname{adj}(A)=C^T$。

矩阵乘积 $AC^T$ 的第 $i$ 行、第 $j$ 列元素为
$$
(AC^T)_{ij}=\sum_{k=1}^n a_{ik}C_{jk}
=\begin{cases}
\det A,&i=j,\\
0,&i\ne j.
\end{cases}
$$
当 $i=j$ 时，求和式就是沿第 $i$ 行的代数余子式展开。当 $i\ne j$ 时，将原矩阵第 $j$ 行替换为第 $i$ 行，所得矩阵有两行相同；沿第 $j$ 行展开即得零。于是
$$
AC^T=(\det A)I_n.
$$
若 $\det A\ne0$，则
$$
\boxed{A^{-1}=\frac{1}{\det A}\operatorname{adj}(A)
=\frac{1}{\det A}C^T.}
$$

**例题**　求
$$
A=\begin{bmatrix}2&1\\1&3\end{bmatrix}
$$
的逆矩阵。先算 $\det A=5$。代数余子式矩阵为
$$
C=\begin{bmatrix}3&-1\\-1&2\end{bmatrix},
$$
故
$$
A^{-1}=\frac15\begin{bmatrix}3&-1\\-1&2\end{bmatrix}.
$$

**验算**　直接相乘得
$$
AA^{-1}=\frac15
\begin{bmatrix}2&1\\1&3\end{bmatrix}
\begin{bmatrix}3&-1\\-1&2\end{bmatrix}
=I_2.
$$

**易错**　构造逆矩阵时要把代数余子式矩阵转置；只有 $\det A\ne0$ 才能除以行列式。一般矩阵的余子式矩阵并不对称。

### 20.2 用克拉默法则求解线性方程组

**适用**　$A$ 为 $n$ 阶可逆矩阵，需要把 $Ax=b$ 的每个未知量写成行列式之比。

**步骤**　设 $A=[a_1\ \cdots\ a_n]$，将 $A$ 的第 $j$ 列换成 $b$ 得到矩阵 $B_j$。由
$$
b=Ax=\sum_{k=1}^n x_ka_k
$$
及行列式对第 $j$ 列的线性性，有
$$
\det B_j
=\sum_{k=1}^n x_k
\det[a_1,\ldots,a_{j-1},a_k,a_{j+1},\ldots,a_n].
$$
当 $k\ne j$ 时，括号内有两列相同，行列式为零；当 $k=j$ 时，得到 $\det A$。所以克拉默法则（Cramer's Rule）为
$$
\boxed{x_j=\frac{\det B_j}{\det A}\qquad(j=1,\ldots,n).}
$$

**例题**　求解
$$
\begin{cases}
2x+y=5,\\
x+3y=7.
\end{cases}
$$
系数矩阵为 $A=\begin{bmatrix}2&1\\1&3\end{bmatrix}$，且 $\det A=5$。分别替换两列：
$$
B_1=\begin{bmatrix}5&1\\7&3\end{bmatrix},
\qquad
B_2=\begin{bmatrix}2&5\\1&7\end{bmatrix}.
$$
于是
$$
x=\frac{\det B_1}{\det A}=\frac{15-7}{5}=\frac85,
\qquad
y=\frac{\det B_2}{\det A}=\frac{14-5}{5}=\frac95.
$$

**验算**　将 $x=8/5$、$y=9/5$ 代入原方程，分别得到 $2x+y=5$、$x+3y=7$。

**易错**　求第 $j$ 个未知量时替换的是第 $j$ **列**，且分母始终是原系数矩阵的行列式。该公式要求 $A$ 为可逆方阵；大型方程组的实际数值求解通常采用消元法或矩阵分解。

### 20.3 用行列式计算面积与体积

**适用**　已知两个或三个向量，需要求它们张成的平行四边形面积或平行六面体体积；也可判断线性变换的体积缩放倍数。

**步骤**　在二维空间中，将两个向量 $u=(a,b)^T$、$v=(c,d)^T$ 作为矩阵的列，则它们张成的平行四边形面积为
$$
S=\left|\det[u\ v]\right|
=\left|\begin{vmatrix}a&c\\b&d\end{vmatrix}\right|
=|ad-bc|.
$$
在三维空间中，三个向量 $u,v,w$ 张成的平行六面体体积为
$$
V=\left|\det[u\ v\ w]\right|.
$$
对线性变换 $x\mapsto Ax$，单位正方形或单位立方体变换后的面积或体积为 $|\det A|$。交换两行仅改变定向；一行乘以 $c$ 使带符号体积乘以 $c$；一行加上另一行的倍数保持带符号体积不变。这与行列式的行变换性质对应。

**例题**　在二维空间中，$u=(2,1)^T$、$v=(1,3)^T$ 张成的平行四边形面积为
$$
S=\left|\begin{vmatrix}2&1\\1&3\end{vmatrix}\right|=5.
$$
在三维空间中，取
$$
u=\begin{bmatrix}1\\0\\0\end{bmatrix},\quad
v=\begin{bmatrix}1\\2\\0\end{bmatrix},\quad
w=\begin{bmatrix}0\\1\\3\end{bmatrix}.
$$
对应矩阵为上三角矩阵，所以
$$
V=\left|\begin{vmatrix}1&1&0\\0&2&1\\0&0&3\end{vmatrix}\right|=6.
$$

**验算**　二维面积也可用底乘高得到 $5$；三维例题的底面位于 $xy$ 平面，面积为 $2$，高度为 $3$，体积为 $6$。

**易错**　几何面积与体积取行列式的**绝对值**。当 $\det A=0$ 时，变换使维数下降，$n$ 维体积为零。

### 20.4 用行列式判断正交变换的定向

**适用**　已知正交矩阵，需判断它是否保持体积以及是否反转定向。

**步骤**　正交矩阵满足 $Q^TQ=I$。两边取行列式，并使用 $\det(Q^T)=\det Q$，得到
$$
(\det Q)^2=\det(Q^TQ)=1,
\qquad
\boxed{\det Q=\pm1.}
$$
因此，正交变换保持长度与体积。$\det Q=1$ 时保持定向，$\det Q=-1$ 时反转定向。

**例题**　比较二维旋转矩阵
$$
R=\begin{bmatrix}0&-1\\1&0\end{bmatrix}
$$
与关于 $y$ 轴的反射矩阵
$$
F=\begin{bmatrix}-1&0\\0&1\end{bmatrix}.
$$
二者均为正交矩阵，且
$$
\det R=1,\qquad \det F=-1.
$$
它们都保持面积；前者保持定向，后者反转定向。

**验算**　直接计算 $R^TR=F^TF=I_2$。两者行列式的绝对值均为 $1$。

**易错**　正交矩阵的行列式可以是 $1$ 或 $-1$；定向与体积大小是不同的几何信息。
