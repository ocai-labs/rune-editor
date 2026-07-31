// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

function Icon({
  size,
  width,
  height,
  viewBox = "0 0 20 20",
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={viewBox}
      fill="currentColor"
      width={width ?? size}
      height={height ?? size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function BoldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.428 3.95a.875.875 0 0 0-.875.875v10.35c0 .483.392.875.875.875h3.81c1.377 0 2.461-.298 3.203-.963.763-.682 1.006-1.607 1.006-2.5 0-1.199-.582-2.18-1.483-2.788.704-.64 1.007-1.494 1.007-2.386 0-2.145-2.08-3.463-4.086-3.463zm.875 6.925h3.359c1.303 0 2.035.805 2.035 1.713 0 .586-.153.954-.423 1.196-.29.26-.873.516-2.036.516H7.303zm2.165-1.75H7.303V5.7h2.582c1.452 0 2.336.9 2.336 1.713 0 .515-.172.89-.516 1.16-.373.294-1.057.55-2.237.552" />
    </Icon>
  );
}

export function ItalicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m10.541 5.45-2.374 9.1H6.4a.625.625 0 1 0 0 1.25h4.5a.625.625 0 1 0 0-1.25H9.46l2.374-9.1H13.6a.625.625 0 1 0 0-1.25H9.1a.625.625 0 1 0 0 1.25z" />
    </Icon>
  );
}

export function UnderlineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.4 5.45a.625.625 0 1 0 0-1.25h-2.7a.625.625 0 1 0 0 1.25h.725v5.54c0 1.743-1.434 3.335-3.425 3.335-1.235 0-2.07-.414-2.602-.996-.541-.594-.823-1.423-.823-2.339V5.45H7.3a.625.625 0 0 0 0-1.25H4.6a.625.625 0 1 0 0 1.25h.725v5.54c0 1.163.358 2.314 1.15 3.181.8.877 1.99 1.404 3.525 1.404 2.699 0 4.675-2.17 4.675-4.585V5.45zm1.525 12.2c0 .345-.28.625-.625.625H3.7a.625.625 0 1 1 0-1.25h12.6c.345 0 .625.28.625.625" />
    </Icon>
  );
}

export function ClearFormatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.75 4.2c.345 0 .625.28.625.625v1.8a.625.625 0 0 1-1.25 0V5.45h-3.25v9.1h.726a.626.626 0 0 1 0 1.25H6.9a.625.625 0 1 1 0-1.25h.724v-9.1h-3.25v1.175a.625.625 0 0 1-1.25 0v-1.8c0-.345.28-.625.625-.625z" />
      <path d="M16.176 9.558a.626.626 0 0 1 .884.884l-1.68 1.68 1.68 1.679a.625.625 0 0 1-.884.884l-1.68-1.68-1.679 1.68a.626.626 0 0 1-.884-.884l1.678-1.68-1.678-1.679a.626.626 0 0 1 .884-.884l1.68 1.678z" />
    </Icon>
  );
}

export function StrikethroughIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.065 9.373H16.3a.627.627 0 1 1 0 1.255h-3.233q.063.052.122.107c.723.665 1.038 1.505 1.038 2.456 0 1.024-.503 1.868-1.288 2.436-.772.56-1.81.85-2.939.85s-2.167-.29-2.94-.85c-.784-.568-1.288-1.412-1.288-2.436a.628.628 0 0 1 1.255 0c0 .571.268 1.057.77 1.42.513.37 1.276.611 2.203.611.928 0 1.69-.24 2.204-.611.5-.363.768-.849.768-1.42 0-.645-.199-1.134-.632-1.532-.452-.416-1.207-.777-2.405-1.032H3.7a.627.627 0 1 1 0-1.254h3.233l-.122-.108C6.088 8.6 5.773 7.76 5.773 6.81c0-1.024.503-1.868 1.288-2.436.772-.56 1.81-.85 2.94-.85s2.166.29 2.938.85c.785.568 1.289 1.412 1.289 2.436a.628.628 0 0 1-1.255 0c0-.571-.268-1.057-.77-1.42-.513-.37-1.275-.611-2.203-.611s-1.69.24-2.203.612c-.502.362-.77.848-.77 1.42 0 .644.2 1.133.633 1.531.452.416 1.207.777 2.405 1.032" />
    </Icon>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.6 3.172a.625.625 0 0 0-1.201-.344l-4 14a.625.625 0 0 0 1.202.344zM5.842 5.158a.625.625 0 0 1 0 .884L1.884 10l3.958 3.958a.625.625 0 0 1-.884.884l-4.4-4.4a.625.625 0 0 1 0-.884l4.4-4.4a.625.625 0 0 1 .884 0m8.316 0a.625.625 0 0 1 .884 0l4.4 4.4a.625.625 0 0 1 0 .884l-4.4 4.4a.625.625 0 0 1-.884-.884L18.116 10l-3.958-3.958a.625.625 0 0 1 0-.884" />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon viewBox="2.5 0 14.92 20" {...props}>
      <path d="M10.61 3.61a3.776 3.776 0 0 1 5.34 0l.367.368a3.776 3.776 0 0 1 0 5.34l-1.852 1.853a.625.625 0 1 1-.884-.884l1.853-1.853a2.526 2.526 0 0 0 0-3.572l-.368-.367a2.526 2.526 0 0 0-3.572 0L9.641 6.347a.625.625 0 1 1-.883-.883z" />
      <path d="M12.98 6.949a.625.625 0 0 1 0 .884L7.53 13.28a.625.625 0 0 1-.884-.884l5.448-5.448a.625.625 0 0 1 .884 0" />
      <path d="M6.348 8.757a.625.625 0 0 1 0 .884l-1.853 1.853a2.526 2.526 0 0 0 0 3.572l.367.367a2.525 2.525 0 0 0 3.572 0l1.853-1.852a.625.625 0 1 1 .884.883l-1.853 1.853a3.776 3.776 0 0 1-5.34 0l-.367-.367a3.776 3.776 0 0 1 0-5.34l1.853-1.853a.625.625 0 0 1 .884 0" />
    </Icon>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.875 7.505c0-.345.28-.625.625-.625h7a.625.625 0 1 1 0 1.25h-7a.625.625 0 0 1-.625-.625m0 3c0-.345.28-.625.625-.625h5a.625.625 0 1 1 0 1.25h-5a.625.625 0 0 1-.625-.625" />
      <path d="M17.625 5.255A2.125 2.125 0 0 0 15.5 3.13h-11a2.125 2.125 0 0 0-2.125 2.125v7.5c0 1.173.951 2.125 2.125 2.125h1.188v2.482a.625.625 0 0 0 1.006.496l3.87-2.978H15.5a2.125 2.125 0 0 0 2.125-2.125zM15.5 4.38c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-5.148a.63.63 0 0 0-.38.13l-3.034 2.333v-1.838a.625.625 0 0 0-.625-.625H4.5a.875.875 0 0 1-.875-.875v-7.5c0-.483.392-.875.875-.875z" />
    </Icon>
  );
}

export function Heading1Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.1 4.825a.625.625 0 0 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15H4.1zM17.074 8.45a.6.6 0 0 1 .073.362q.003.03.003.063v6.3a.625.625 0 1 1-1.25 0V9.802l-1.55.846a.625.625 0 1 1-.6-1.098l2.476-1.35a.625.625 0 0 1 .848.25" />
    </Icon>
  );
}

export function Heading2Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.65 4.825a.625.625 0 1 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15h-6.4zm10.104 5.164c.19-.457.722-.84 1.394-.84.89 0 1.48.627 1.48 1.238 0 .271-.104.53-.302.746l-3.837 3.585a.625.625 0 0 0 .427 1.082h4.5a.625.625 0 1 0 0-1.25H14.5l2.695-2.518.027-.028c.406-.43.657-.994.657-1.617 0-1.44-1.299-2.488-2.731-2.488-1.128 0-2.145.643-2.548 1.608a.625.625 0 0 0 1.154.482" />
    </Icon>
  );
}

export function Heading3Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.877 4.2c.346 0 .625.28.625.625V9.15h6.4V4.825a.625.625 0 0 1 1.25 0v10.35a.625.625 0 0 1-1.25 0V10.4h-6.4v4.775a.625.625 0 0 1-1.25 0V4.825c0-.345.28-.625.625-.625M14.93 9.37c-.692 0-1.183.34-1.341.671a.625.625 0 1 1-1.128-.539c.416-.87 1.422-1.382 2.47-1.382.686 0 1.33.212 1.818.584.487.373.843.932.843 1.598 0 .629-.316 1.162-.76 1.533l.024.018c.515.389.892.972.892 1.669 0 .696-.377 1.28-.892 1.668s-1.198.61-1.926.61c-1.1 0-2.143-.514-2.599-1.389a.625.625 0 0 1 1.109-.578c.187.36.728.717 1.49.717.482 0 .895-.148 1.174-.358s.394-.453.394-.67-.116-.46-.394-.67c-.28-.21-.692-.358-1.174-.358h-.461a.625.625 0 0 1 0-1.25h.357a1 1 0 0 1 .104-.01c.437 0 .81-.135 1.06-.326s.351-.41.351-.605-.101-.415-.351-.606-.623-.327-1.06-.327" />
    </Icon>
  );
}

export function ToggleListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.7 7.519c0 .39.421.633.757.436L6.05 6.437a.506.506 0 0 0 0-.874L3.457 4.045a.503.503 0 0 0-.757.436zm5.8-2.144a.625.625 0 1 0 0 1.25H16a.625.625 0 1 0 0-1.25zm0 8a.625.625 0 1 0 0 1.25H16a.625.625 0 1 0 0-1.25zm-5.043 2.58a.503.503 0 0 1-.757-.436V12.48c0-.39.421-.633.757-.436l2.593 1.518a.506.506 0 0 1 0 .874z" />
    </Icon>
  );
}

export function ToggleHeading1Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.085 5.4a.577.577 0 1 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm11.506 3.225a.55.55 0 0 1 .064.32l.003.055v5.6a.55.55 0 1 1-1.1 0V9.815l-1.386.756a.55.55 0 1 1-.527-.966l2.2-1.2a.55.55 0 0 1 .746.22M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z" />
    </Icon>
  );
}

export function ToggleHeading2Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.085 5.4a.577.577 0 0 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm8.955 4.588c.17-.409.645-.75 1.244-.75.793 0 1.322.559 1.322 1.106a.98.98 0 0 1-.271.667l-3.41 3.187a.55.55 0 0 0 .375.952h4a.55.55 0 1 0 0-1.1h-2.606l2.406-2.248.024-.024a2.08 2.08 0 0 0 .582-1.434c0-1.277-1.151-2.206-2.422-2.206-1 0-1.902.57-2.26 1.426a.55.55 0 1 0 1.016.424M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z" />
    </Icon>
  );
}

export function ToggleHeading3Icon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.508 4.823c.318 0 .577.258.577.577v3.823h5.645V5.4a.577.577 0 0 1 1.154 0v9.2a.577.577 0 1 1-1.154 0v-4.223H7.086V14.6a.577.577 0 1 1-1.154 0V5.4c0-.319.258-.577.577-.577m10.775 4.415c-.644 0-1.105.316-1.256.631a.55.55 0 1 1-.992-.474c.377-.79 1.292-1.257 2.248-1.257.626 0 1.214.193 1.657.532s.765.846.765 1.45c0 .58-.297 1.072-.715 1.41l.05.036c.468.353.81.883.81 1.514 0 .63-.342 1.16-.81 1.514-.47.354-1.093.556-1.757.556-1.005 0-1.953-.47-2.368-1.264a.55.55 0 1 1 .976-.508c.178.341.685.672 1.392.672.448 0 .833-.138 1.094-.334.26-.197.372-.427.372-.636s-.111-.44-.372-.636c-.26-.196-.646-.334-1.094-.334h-.424a.55.55 0 0 1 0-1.1h.33a1 1 0 0 1 .094-.008c.406 0 .754-.127.989-.306.234-.18.333-.388.333-.576s-.099-.397-.333-.576c-.235-.18-.583-.306-.99-.306M.962 11.14c0 .455.495.735.885.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.885.5z" />
    </Icon>
  );
}

export function TextIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.875 4.825c0-.345.28-.625.625-.625h9c.345 0 .625.28.625.625v1.8a.625.625 0 1 1-1.25 0V5.45h-3.25v9.1h.725a.625.625 0 1 1 0 1.25h-2.7a.625.625 0 1 1 0-1.25h.725v-9.1h-3.25v1.175a.625.625 0 1 1-1.25 0z" />
    </Icon>
  );
}

export function BulletListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.809 12.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M16 13.375a.625.625 0 1 1 0 1.25H8.5a.625.625 0 0 1 0-1.25zM4.809 4.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M16 5.375a.625.625 0 1 1 0 1.25H8.5a.625.625 0 0 1 0-1.25z" />
    </Icon>
  );
}

export function NumberedListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.088 3.026a.55.55 0 0 1 .27.474v4a.55.55 0 0 1-1.1 0V4.435l-.24.134a.55.55 0 1 1-.535-.962l1.059-.588a.55.55 0 0 1 .546.007M8.5 5.375a.625.625 0 1 0 0 1.25H16a.625.625 0 1 0 0-1.25zm0 8a.625.625 0 0 0 0 1.25H16a.625.625 0 1 0 0-1.25zM6 16.55H3.5a.55.55 0 0 1-.417-.908l1.923-2.24a.7.7 0 0 0 .166-.45.335.335 0 0 0-.266-.327l-.164-.035a.6.6 0 0 0-.245.004l-.03.007a.57.57 0 0 0-.426.44.55.55 0 1 1-1.08-.206 1.67 1.67 0 0 1 1.248-1.304l.029-.007c.24-.058.49-.061.732-.01l.164.035c.664.14 1.138.726 1.138 1.404 0 .427-.153.84-.432 1.165L4.697 15.45H6a.55.55 0 0 1 0 1.1" />
    </Icon>
  );
}

export function TaskListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.184 10.804a1.1 1.1 0 0 1 1.1 1.1v2.8a1.1 1.1 0 0 1-1.1 1.1h-2.8a1.1 1.1 0 0 1-1.1-1.1v-2.8a1.1 1.1 0 0 1 1.1-1.1zm-2.65 3.75h2.5v-2.5h-2.5zm13.339-1.875a.625.625 0 0 1 0 1.25H9.748a.625.625 0 1 1 0-1.25zM6.748 3.394a.625.625 0 0 1 1.072.642l-2.85 4.75a.626.626 0 0 1-1.01.086l-1.9-2.217a.626.626 0 0 1 .948-.813l1.336 1.557zm10.125 2.634a.626.626 0 0 1 0 1.25H9.748a.625.625 0 1 1 0-1.25z" />
    </Icon>
  );
}

export function CalloutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.276 5.766a.6.6 0 0 1 .11.033l.034.017.067.037q.019.012.036.026l.051.042q.018.015.033.034a.6.6 0 0 1 .107.158l.014.03q.046.11.047.235v1.26a.626.626 0 0 1-1.25 0v-.635h-1.9v5.994h.32l.125.013a.625.625 0 0 1 0 1.224l-.126.013h-.934l-.01.001h-.945a.625.625 0 0 1 0-1.25h.32V7.002h-1.9v.635a.626.626 0 0 1-1.25 0v-1.26a.625.625 0 0 1 .626-.625h6.3z" />
      <path d="M14.75 3.125c1.174 0 2.125.951 2.125 2.125v9.5a2.125 2.125 0 0 1-2.125 2.125h-9.5a2.125 2.125 0 0 1-2.125-2.125v-9.5c0-1.174.951-2.125 2.125-2.125zm-9.5 1.25a.875.875 0 0 0-.875.875v9.5c0 .483.392.875.875.875h9.5a.875.875 0 0 0 .875-.875v-9.5a.875.875 0 0 0-.875-.875z" />
    </Icon>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.796 4.971a5.067 5.067 0 0 0-5.067 5.067v.635a4.433 4.433 0 0 0 4.433 4.433 3.164 3.164 0 1 0-3.11-3.75 3.2 3.2 0 0 1-.073-.683v-.635a3.817 3.817 0 0 1 3.817-3.817h.635a.625.625 0 1 0 0-1.25zm-9.054 0a5.067 5.067 0 0 0-5.067 5.068v.634a4.433 4.433 0 0 0 4.433 4.433 3.164 3.164 0 1 0-3.11-3.75 3.2 3.2 0 0 1-.073-.683v-.634A3.817 3.817 0 0 1 6.742 6.22h.635a.625.625 0 1 0 0-1.25z" />
    </Icon>
  );
}

export function TableIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 4.125A2.125 2.125 0 0 0 2.375 6.25v7.5c0 1.174.951 2.125 2.125 2.125h11a2.125 2.125 0 0 0 2.125-2.125v-7.5A2.125 2.125 0 0 0 15.5 4.125zm11.875 7h-5.75v-2.25h5.75zm-5.75 1.25h5.75v1.375a.875.875 0 0 1-.875.875h-4.875zm-1.25-1.25h-5.75v-2.25h5.75zm-5.75 1.25h5.75v2.25H4.5a.875.875 0 0 1-.875-.875zm0-4.75V6.25c0-.483.392-.875.875-.875h4.875v2.25zm7 0v-2.25H15.5c.483 0 .875.392.875.875v1.375z" />
    </Icon>
  );
}

export function ImageBlockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 9.31a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" />
      <path d="M2.375 6.25c0-1.174.951-2.125 2.125-2.125h11c1.174 0 2.125.951 2.125 2.125v7.5a2.125 2.125 0 0 1-2.125 2.125h-11a2.125 2.125 0 0 1-2.125-2.125zM4.5 5.375a.875.875 0 0 0-.875.875v5.491l1.996-1.995a.625.625 0 0 1 .883 0l1.98 1.98 4.137-4.137a.625.625 0 0 1 .883 0l2.871 2.87V6.25a.875.875 0 0 0-.875-.875zm11.875 6.852-3.312-3.312-4.137 4.136a.625.625 0 0 1-.884 0l-1.98-1.98-2.437 2.438v.241c0 .483.392.875.875.875h11a.875.875 0 0 0 .875-.875z" />
    </Icon>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.814 12.407c0 .295.323.479.58.33l4.165-2.407a.38.38 0 0 0 0-.66L8.394 7.263a.385.385 0 0 0-.58.33z" />
      <path d="M4.5 4.125A2.125 2.125 0 0 0 2.375 6.25v7.5c0 1.174.951 2.125 2.125 2.125h11a2.125 2.125 0 0 0 2.125-2.125v-7.5A2.125 2.125 0 0 0 15.5 4.125zM3.625 6.25c0-.483.392-.875.875-.875h11c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-11a.875.875 0 0 1-.875-.875z" />
    </Icon>
  );
}

export function AudioIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.207 3.197c.619-.578 1.63-.14 1.63.708v12.417c0 .847-1.011 1.286-1.63.708l-3.523-3.291H2.712a.625.625 0 0 1-.625-.625v-6c0-.346.28-.625.625-.625h2.972zm.38 1.356L6.357 7.57a.63.63 0 0 1-.426.169H3.337v4.75H5.93c.158 0 .31.06.426.168l3.23 3.017zm3.224 2.08a.625.625 0 0 1 .88.08 5.31 5.31 0 0 1 0 6.8.625.625 0 0 1-.96-.8 4.06 4.06 0 0 0 0-5.2.625.625 0 0 1 .08-.88" />
      <path d="M16.224 4.755a.625.625 0 0 0-1.024.717 8.09 8.09 0 0 1 0 9.283.625.625 0 0 0 1.024.717 9.34 9.34 0 0 0 0-10.717" />
    </Icon>
  );
}

export function FileBlockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.184 3.64A3.475 3.475 0 0 1 15.1 8.554l-5.374 5.374a2.05 2.05 0 1 1-2.9-2.9l2.688-2.686a.625.625 0 0 1 .884.884L7.71 11.913a.8.8 0 0 0 1.13 1.131l5.375-5.374a2.225 2.225 0 1 0-3.147-3.146L5.694 9.898a3.65 3.65 0 1 0 5.162 5.161l4.702-4.702a.625.625 0 0 1 .884.884l-4.702 4.702a4.9 4.9 0 1 1-6.93-6.93z" />
    </Icon>
  );
}

export function MathIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.125 4.25c0 .345-.28.625-.625.625H9.07l-4.745 11.12a.626.626 0 0 1-1.07.137l-.049-.073-2.25-3.97-.05-.115a.625.625 0 0 1 1.065-.604l.073.103 1.626 2.869L8.081 4.005l.043-.083a.63.63 0 0 1 .532-.297H18.5c.345 0 .625.28.625.625" />
      <path d="M17.405 15.476a.625.625 0 0 1-.968.748l-.087-.092-2.694-3.487-2.693 3.487-.087.092a.624.624 0 0 1-.969-.748l.068-.108 2.892-3.743-2.892-3.743-.068-.108a.625.625 0 0 1 .97-.748l.086.092 2.693 3.486 2.694-3.486.087-.092a.624.624 0 0 1 .968.748l-.067.108-2.892 3.743 2.892 3.743z" />
    </Icon>
  );
}

export function TeXIcon(props: IconProps) {
  return (
    <Icon role="graphics-symbol" {...props}>
      <path d="M12.908 5.638a.625.625 0 0 1 0 1.224l-.126.013H8.831l2.921 2.663a.626.626 0 0 1 0 .924l-2.921 2.663h3.951l.126.013a.625.625 0 0 1 0 1.224l-.126.013H7.218a.626.626 0 0 1-.421-1.087L10.402 10 6.797 6.712a.625.625 0 0 1 .42-1.087h5.565z" />
      <path d="M14.75 3.125c1.174 0 2.125.951 2.125 2.125v9.5a2.125 2.125 0 0 1-2.125 2.125h-9.5a2.125 2.125 0 0 1-2.125-2.125v-9.5c0-1.174.951-2.125 2.125-2.125zm-9.5 1.25a.875.875 0 0 0-.875.875v9.5c0 .483.392.875.875.875h9.5a.875.875 0 0 0 .875-.875v-9.5a.875.875 0 0 0-.875-.875z" />
    </Icon>
  );
}

export function FitWidthIcon(props: IconProps) {
  return (
    <Icon role="graphics-symbol" {...props}>
      <path d="M5.393 6.022a.625.625 0 0 1 0 .884L2.924 9.375h5.662a.625.625 0 1 1 0 1.25H2.924l2.469 2.469a.625.625 0 0 1-.884.883L.974 10.442a.625.625 0 0 1 0-.884l3.535-3.536a.625.625 0 0 1 .884 0m6.026 3.353a.625.625 0 1 0 0 1.25h5.648l-2.469 2.469a.625.625 0 1 0 .884.883l3.535-3.535a.625.625 0 0 0 0-.884l-3.535-3.536a.625.625 0 0 0-.884.884l2.469 2.469z" />
    </Icon>
  );
}

export function CaptionIcon(props: IconProps) {
  return (
    <Icon role="graphics-symbol" {...props}>
      <path d="M5.5 2.375A2.125 2.125 0 0 0 3.375 4.5v5.25c0 1.174.951 2.125 2.125 2.125H13a2.125 2.125 0 0 0 2.125-2.125V4.5A2.125 2.125 0 0 0 13 2.375zM4.625 4.5c0-.483.392-.875.875-.875H13c.483 0 .875.392.875.875v5.25a.875.875 0 0 1-.875.875H5.5a.875.875 0 0 1-.875-.875zm-1.25 9.62c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H4a.625.625 0 0 1-.625-.625m0 2.88c0-.345.28-.625.625-.625h8.55a.625.625 0 1 1 0 1.25H4A.625.625 0 0 1 3.375 17" />
    </Icon>
  );
}

export function DividerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="9.375" width="14" height="1.25" rx="0.625" />
    </Icon>
  );
}

export function EmojiIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m0-1.25A5.75 5.75 0 1 1 10 4.25a5.75 5.75 0 0 1 0 11.5M7.5 9.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m5.75-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M7.05 11.65a.625.625 0 0 1 .867.176C8.376 12.488 9.135 13 10 13s1.624-.512 2.083-1.174a.625.625 0 1 1 1.024.715C12.475 13.448 11.355 14.25 10 14.25s-2.475-.802-3.107-1.709a.625.625 0 0 1 .157-.891"
      />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M8 5l5 5-5 5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m5 8 5 5 5-5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m5 10 3 3 7-7" />
    </Icon>
  );
}

export function RepeatIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </Icon>
  );
}

export function PaintRollerIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="16" height="6" x="2" y="2" rx="2" />
      <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect width="4" height="6" x="8" y="16" rx="1" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20" />
      <path d="M12 2a14.5 14.5 0 0 1 0 20" />
      <path d="M2 12h20" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Icon>
  );
}

export function CornerDownLeftIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </Icon>
  );
}

export function CircleXIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Icon>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Icon>
  );
}

export function TableHeaderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.375 6.25c0-1.174.951-2.125 2.125-2.125h11c1.174 0 2.125.951 2.125 2.125v7.5a2.125 2.125 0 0 1-2.125 2.125h-11a2.125 2.125 0 0 1-2.125-2.125zm14 2.625h-5.75v2.25h5.75zm0 3.5h-5.75v2.25H15.5a.875.875 0 0 0 .875-.875zm-7-3.5h-5.75v2.25h5.75zm0 3.5h-5.75v1.375c0 .483.392.875.875.875h4.875z" />
    </Icon>
  );
}

export function TableOfContentsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.125 14.75c0-.345.28-.625.625-.625h10.1a.625.625 0 0 1 0 1.25H8.75a.625.625 0 0 1-.625-.625M7 9.375a.625.625 0 1 0 0 1.25h10.1a.625.625 0 1 0 0-1.25zm-1.75-4.75a.625.625 0 0 0 0 1.25h10.1a.625.625 0 1 0 0-1.25zM2.9 9.375a.625.625 0 1 0 0 1.25h1.5a.625.625 0 1 0 0-1.25zM.525 5.25c0-.345.28-.625.625-.625h1.5a.625.625 0 0 1 0 1.25h-1.5a.625.625 0 0 1-.625-.625m4.125 8.875a.625.625 0 0 0 0 1.25h1.5a.625.625 0 1 0 0-1.25z" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 14 14" {...props}>
      <path d="M3.5 2.2a.7.7 0 0 1 1.08-.59l7.2 4.8a.7.7 0 0 1 0 1.18l-7.2 4.8A.7.7 0 0 1 3.5 11.8V2.2z" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 14 14" {...props}>
      <rect x="3" y="2" width="3" height="10" rx="0.7" />
      <rect x="8" y="2" width="3" height="10" rx="0.7" />
    </Icon>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 5.5h1.5L7 3v8L3.5 8.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z" fill="currentColor" stroke="none" />
      <path d="M9.5 5a3 3 0 0 1 0 4" />
      <path d="M11 3.5a5.5 5.5 0 0 1 0 7" />
    </Icon>
  );
}

export function VolumeMuteIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 5.5h1.5L7 3v8L3.5 8.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z" fill="currentColor" stroke="none" />
      <path d="M10 5.5l3 3M13 5.5l-3 3" />
    </Icon>
  );
}

export function AlignLeftIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 16 16" {...props}>
      <path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm1.2 2A1.825 1.825 0 0 0 1.775 6v4c0 1.008.817 1.825 1.825 1.825H8A1.825 1.825 0 0 0 9.825 10V6A1.825 1.825 0 0 0 8 4.175zM3.025 6c0-.318.258-.575.575-.575H8c.318 0 .575.257.575.575v4a.575.575 0 0 1-.575.575H3.6A.575.575 0 0 1 3.025 10zM2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z" />
    </Icon>
  );
}

export function AlignCenterIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 16 16" {...props}>
      <path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm3.4 2h4.4c1.008 0 1.825.817 1.825 1.825v4a1.825 1.825 0 0 1-1.825 1.825H5.8A1.825 1.825 0 0 1 3.975 10V6c0-1.008.817-1.825 1.825-1.825M5.225 6v4c0 .318.258.575.575.575h4.4a.575.575 0 0 0 .575-.575V6a.575.575 0 0 0-.575-.575H5.8A.575.575 0 0 0 5.225 6M2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z" />
    </Icon>
  );
}

export function AlignRightIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 16 16" {...props}>
      <path d="M2.4 2.175a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25zm5.6 2A1.825 1.825 0 0 0 6.175 6v4c0 1.008.817 1.825 1.825 1.825h4.4A1.825 1.825 0 0 0 14.225 10V6A1.825 1.825 0 0 0 12.4 4.175zM7.425 6c0-.318.257-.575.575-.575h4.4c.318 0 .575.257.575.575v4a.575.575 0 0 1-.575.575H8A.575.575 0 0 1 7.425 10zM2.4 12.575a.625.625 0 1 0 0 1.25h11.2a.625.625 0 1 0 0-1.25z" />
    </Icon>
  );
}

export function ArrowDiagonalUpRightIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 16 16" {...props}>
      <path d="M5.603 3.663a.625.625 0 1 0 0 1.25h4.6l-6.37 6.371a.615.615 0 0 0 .013.87.616.616 0 0 0 .87.014l6.371-6.372v4.601a.625.625 0 1 0 1.25 0v-6.11a.625.625 0 0 0-.625-.624z" />
    </Icon>
  );
}

export function EllipsisIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 16 16" {...props}>
      <path d="M3.2 6.725a1.275 1.275 0 1 0 0 2.55 1.275 1.275 0 0 0 0-2.55m4.8 0a1.275 1.275 0 1 0 0 2.55 1.275 1.275 0 0 0 0-2.55m4.8 0a1.275 1.275 0 1 0 0 2.55 1.275 1.275 0 0 0 0-2.55" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Icon>
  );
}
