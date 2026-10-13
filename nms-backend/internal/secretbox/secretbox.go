// Package secretbox encrypts small secrets (device passwords) for storage in the database.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

type Box struct{ aead cipher.AEAD }

// New derives an AES-256-GCM key from the given secret material.
func New(secret []byte) (*Box, error) {
	k := sha256.Sum256(append([]byte("nms-secretbox-v1:"), secret...))
	b, err := aes.NewCipher(k[:])
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(b)
	if err != nil {
		return nil, err
	}
	return &Box{g}, nil
}

func (b *Box) Seal(plain string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (b *Box) Open(enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	n := b.aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("secretbox: ciphertext too short")
	}
	out, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", errors.New("secretbox: cannot decrypt (secret key changed?)")
	}
	return string(out), nil
}
