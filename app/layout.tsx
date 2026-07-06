import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "鲸天 V3 运单全流程管理",
  description: "录单、扫描品控、异常上报、分级审批与执行联动"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
