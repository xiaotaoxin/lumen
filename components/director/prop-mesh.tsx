"use client";

/**
 * 道具几何 —— 用基本图元拼出"看得懂是什么"的简化模型。
 * 后续接 GLB 时按 kind 分流加载真实模型即可。
 */

import * as THREE from "three";
import type { DirectorPropKind } from "@/lib/types";

interface Props {
  kind: DirectorPropKind;
  highlight: boolean;
}

const BASE = "#bdb6a8";
const ACCENT = "#665c4d";

export function PropMesh({ kind, highlight }: Props) {
  const tint = highlight ? "#ffaa44" : BASE;
  const tintAccent = highlight ? "#ff8800" : ACCENT;

  switch (kind) {
    case "chair":
      return (
        <group>
          {/* 座面 */}
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.45, 0.06, 0.45]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 靠背 */}
          <mesh position={[0, 0.85, -0.2]}>
            <boxGeometry args={[0.45, 0.85, 0.06]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 4 条腿 */}
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
            <mesh key={i} position={[0.18 * sx, 0.22, 0.18 * sz]}>
              <cylinderGeometry args={[0.025, 0.025, 0.45, 8]} />
              <meshStandardMaterial color={tintAccent} />
            </mesh>
          ))}
        </group>
      );

    case "table-square":
      return (
        <group>
          <mesh position={[0, 0.7, 0]}>
            <boxGeometry args={[1.2, 0.05, 0.7]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
            <mesh key={i} position={[0.55 * sx, 0.35, 0.32 * sz]}>
              <cylinderGeometry args={[0.04, 0.04, 0.7, 8]} />
              <meshStandardMaterial color={tintAccent} />
            </mesh>
          ))}
        </group>
      );

    case "table-round":
      return (
        <group>
          <mesh position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.55, 0.55, 0.05, 32]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.06, 0.1, 0.7, 12]} />
            <meshStandardMaterial color={tintAccent} />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.04, 32]} />
            <meshStandardMaterial color={tintAccent} />
          </mesh>
        </group>
      );

    case "sofa":
      return (
        <group>
          {/* 座垫 */}
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[1.5, 0.3, 0.7]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 靠背 */}
          <mesh position={[0, 0.85, -0.3]}>
            <boxGeometry args={[1.5, 0.6, 0.15]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 左扶手 */}
          <mesh position={[-0.8, 0.55, 0]}>
            <boxGeometry args={[0.15, 0.5, 0.7]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 右扶手 */}
          <mesh position={[0.8, 0.55, 0]}>
            <boxGeometry args={[0.15, 0.5, 0.7]} />
            <meshStandardMaterial color={tint} />
          </mesh>
        </group>
      );

    case "wall-2m":
    case "wall-3m": {
      const len = kind === "wall-3m" ? 3 : 2;
      return (
        <mesh position={[0, 1.25, 0]}>
          <boxGeometry args={[len, 2.5, 0.15]} />
          <meshStandardMaterial color={highlight ? "#ffaa44" : "#9c9387"} />
        </mesh>
      );
    }

    case "column":
      return (
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.2, 0.22, 3, 16]} />
          <meshStandardMaterial color={tint} />
        </mesh>
      );

    case "stairs":
      return (
        <group>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0, 0.1 + i * 0.18, -i * 0.3]}>
              <boxGeometry args={[1.2, 0.18, 0.3]} />
              <meshStandardMaterial color={tint} />
            </mesh>
          ))}
        </group>
      );

    case "tree-small":
      return (
        <group>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.8, 8]} />
            <meshStandardMaterial color="#6b4f2a" />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <coneGeometry args={[0.45, 1.0, 12]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#5b8a3a"} />
          </mesh>
        </group>
      );

    case "tree-large":
      return (
        <group>
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 1.6, 12]} />
            <meshStandardMaterial color="#5a3f24" />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <sphereGeometry args={[0.85, 16, 16]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#4a7a2c"} />
          </mesh>
          <mesh position={[-0.5, 2.0, 0.3]}>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshStandardMaterial color={highlight ? "#ff9933" : "#558a35"} />
          </mesh>
          <mesh position={[0.4, 2.2, -0.4]}>
            <sphereGeometry args={[0.55, 12, 12]} />
            <meshStandardMaterial color={highlight ? "#ff9933" : "#558a35"} />
          </mesh>
        </group>
      );

    case "rock":
      return (
        <mesh position={[0, 0.25, 0]} rotation={[0, 0.3, 0.1]}>
          <dodecahedronGeometry args={[0.45, 0]} />
          <meshStandardMaterial color={highlight ? "#ffaa44" : "#7d7670"} flatShading />
        </mesh>
      );

    case "bush":
      return (
        <group>
          <mesh position={[0, 0.3, 0]}>
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#3d6a2a"} />
          </mesh>
          <mesh position={[-0.25, 0.25, 0.15]}>
            <sphereGeometry args={[0.25, 10, 10]} />
            <meshStandardMaterial color={highlight ? "#ff9933" : "#456f2c"} />
          </mesh>
          <mesh position={[0.25, 0.28, -0.1]}>
            <sphereGeometry args={[0.3, 10, 10]} />
            <meshStandardMaterial color={highlight ? "#ff9933" : "#456f2c"} />
          </mesh>
        </group>
      );

    case "car":
      return (
        <group>
          {/* 车身 */}
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[1.8, 0.5, 0.85]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#b34a3c"} />
          </mesh>
          {/* 车顶 */}
          <mesh position={[0, 1.0, 0]}>
            <boxGeometry args={[1.1, 0.4, 0.8]} />
            <meshStandardMaterial color={highlight ? "#ff9933" : "#9c3e32"} />
          </mesh>
          {/* 4 个轮子 */}
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
            <mesh
              key={i}
              position={[0.65 * sx, 0.25, 0.4 * sz]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.2, 0.2, 0.12, 16]} />
              <meshStandardMaterial color="#222" />
            </mesh>
          ))}
        </group>
      );

    case "bike":
      return (
        <group>
          {/* 两个轮子 */}
          {[-0.4, 0.4].map((x) => (
            <mesh key={x} position={[x, 0.25, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.22, 0.025, 8, 16]} />
              <meshStandardMaterial color="#333" />
            </mesh>
          ))}
          {/* 车架（V 形） */}
          <mesh position={[0, 0.4, 0]} rotation={[0, 0, 0.4]}>
            <cylinderGeometry args={[0.02, 0.02, 0.55, 8]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 座椅 */}
          <mesh position={[-0.15, 0.65, 0]}>
            <boxGeometry args={[0.2, 0.05, 0.1]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          {/* 把手 */}
          <mesh position={[0.4, 0.7, 0]}>
            <boxGeometry args={[0.05, 0.3, 0.05]} />
            <meshStandardMaterial color={tint} />
          </mesh>
        </group>
      );

    case "lamp":
      return (
        <group>
          {/* 杆 */}
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.04, 0.06, 3, 8]} />
            <meshStandardMaterial color={tintAccent} />
          </mesh>
          {/* 灯泡 */}
          <mesh position={[0, 3.05, 0]}>
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshStandardMaterial
              color={highlight ? "#ffaa44" : "#fff5cc"}
              emissive={highlight ? "#ff8833" : "#ffe699"}
              emissiveIntensity={0.6}
            />
          </mesh>
          {/* 灯罩 */}
          <mesh position={[0, 3.05, 0]}>
            <coneGeometry args={[0.18, 0.18, 12, 1, true]} />
            <meshStandardMaterial color={tintAccent} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );

    case "bench":
      return (
        <group>
          {/* 座面 */}
          <mesh position={[0, 0.42, 0]}>
            <boxGeometry args={[1.6, 0.06, 0.4]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 靠背 */}
          <mesh position={[0, 0.78, -0.18]}>
            <boxGeometry args={[1.6, 0.6, 0.05]} />
            <meshStandardMaterial color={tint} />
          </mesh>
          {/* 4 条腿 */}
          {[-1, 1].map((sx) => [-1, 1].map((sz, j) => (
            <mesh key={`${sx}-${sz}-${j}`} position={[0.7 * sx, 0.21, 0.15 * sz]}>
              <cylinderGeometry args={[0.025, 0.025, 0.42, 8]} />
              <meshStandardMaterial color={tintAccent} />
            </mesh>
          )))}
        </group>
      );

    case "trash-bin":
      return (
        <group>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.22, 0.18, 0.8, 16]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#5a6068"} />
          </mesh>
          <mesh position={[0, 0.82, 0]}>
            <torusGeometry args={[0.22, 0.02, 8, 24]} />
            <meshStandardMaterial color={tintAccent} />
          </mesh>
        </group>
      );

    case "arrow":
      return (
        <group>
          {/* 箭杆 */}
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[1.2, 0.04, 0.25]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#3a8eff"} />
          </mesh>
          {/* 箭头 */}
          <mesh position={[0.7, 0.05, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.25, 0.4, 4]} />
            <meshStandardMaterial color={highlight ? "#ffaa44" : "#3a8eff"} />
          </mesh>
        </group>
      );

    case "marker":
      return (
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.55, 32]} />
          <meshBasicMaterial
            color={highlight ? "#ffaa44" : "#3a8eff"}
            side={THREE.DoubleSide}
            transparent
            opacity={0.8}
          />
        </mesh>
      );

    default:
      return (
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color={tint} />
        </mesh>
      );
  }
}
